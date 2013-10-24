(function() {
    /*
        Open two connections, both with autocommit = 0, then run the following in parallel:

        Connection 1:                                       Connection 2:
        Run a statment which acquires a lock
                                                            Run a statement which blocks on the lock
        Run 'SHOW ENGINE INNODB STATUS'
        Rollback
                                                            (unblocks when connection 1 rolls back)
                                                            Rollback

        This is implemented as series of chained promises:

        con1.query
         \
          con2.query
          .         \
          .          rollback
          .
          sleep until con2 is probably blocked
           \
            con1.status
             \
              rollback
    */

    'use strict';

    var connectionDetails = {
        host: 'localhost',
        user: 'root',
        password: '',
        database: 'test'
    };

    /**
     * A list of statements to test. By default, the same statement is run in two concurrent connections. If you
     * want to run two different statements concurrently, use an array containing the two statements.
     */
    var statements = [
        'DELETE FROM test WHERE pri = 4',
        'UPDATE test SET non = 99 WHERE pri = 4',
        'DELETE FROM test WHERE pri = 4 or pri = 8',

        'DELETE FROM test WHERE pri < 3',
        'UPDATE test SET non = 99 WHERE pri < 3',

        'DELETE FROM test WHERE sec = 5',
        'UPDATE test SET non = 99 WHERE sec = 5',

        'DELETE FROM test WHERE sec < 3',
        'UPDATE test SET non = 99 WHERE sec < 3',

        'DELETE FROM test WHERE non = 6',
        'UPDATE test SET non = 99 WHERE non = 6',
        'DELETE FROM test WHERE non < 3',
        'UPDATE test SET non = 99 WHERE non < 3',
        'DELETE FROM test',
        'UPDATE test SET non = 99',

        'INSERT INTO test VALUES (2,2,2)',

        // Interesting that this gives a different result
        ['INSERT INTO test VALUES (2,2,2)', 'DELETE FROM test WHERE sec = 2'],

        // Here the gap lock from the delete blocks the insert intention lock
        ['DELETE FROM test WHERE sec < 2', 'INSERT INTO test VALUES (2,0,0)'],

        // The insert intention locks do not block each other
        ['INSERT INTO test VALUES (2,0,0)', 'INSERT INTO test VALUES (3,0,0)'],

        // Odd that this only locks the primary key
        ['INSERT INTO test VALUES (2,2,2)', 'DELETE FROM test WHERE pri = 2 OR sec = 2'],

        // Need some tricks here to reveal the locks on the newly created index records
        ['UPDATE test SET pri = 15 WHERE pri = 4', 'DELETE FROM test WHERE pri = 15'],

        ['UPDATE test SET sec = 15 WHERE sec = 5', 'DELETE FROM test WHERE sec = 15'],
    ];

    /***************** TO DO ******************/
    statements = [
        // ['DELETE FROM test WHERE sec > 2', 'DELETE FROM test WHERE sec > 2'],
        // This test only blocks if the previous test runs, even with a 5s delay between them.
        // Maybe to do with the index records not being purged after rollback.
        // I will try creating new connections each time, rather than recycling them
        // (though not sure about the implications of that for connection pooling)
        ['INSERT INTO test VALUES (2,0,0)', 'DELETE FROM test WHERE sec > 2'],
    ];


    var Q = require('q');
    var mysql = require('mysql');

    Q.longStackSupport = true;

    var ROLLBACK = 'ROLLBACK';
    var STATUS = 'SHOW ENGINE INNODB STATUS';

    runTests(statements, 50/*ms*/);


    /**
     * Create a table named 'test' and insert some rows into it. The table contains three int columns:
     *   pri (the primary key)
     *   sec (a non-unique key)
     *   non (not a key at all)
     * @param con a valid MySQL connection
     */
    function createTestData(con) {
        con.query('DROP TABLE IF EXISTS test');
        con.query('CREATE TABLE test (pri INT NOT NULL, sec INT, non INT, PRIMARY KEY(pri), KEY(sec)) ENGINE=InnoDB');
        con.query('INSERT INTO test VALUES (0, 1, 2), (4, 5, 6), (8, 9, 10)');
        con.query('COMMIT');
    }

    /**
     * Run each of the given statements on two concurrent MySQL connections and observe the locks which are aquired.
     * @param statements    an array of SQL statements
     * @param delay         how long to wait (in ms) for con2 to block before running 'SHOW ENGINE INNODB STATUS'
     */
    function runTests(statements, delay) {
        var con1 = connect();
        var con2 = connect();

        enableLockMonitor(con1);
        createTestData(con1);

        var promise = Q();

        statements.forEach(function buildPromiseForTest(statement) {
            promise = promise
                .then(function runOneTest() {
                    return runTest(con1, con2, statement, statement, delay);
                })
                .then(logStatus.bind(null, statement));
        });

        promise.done(function tearDown() {
            disableLockMonitor(con1);
            con1.end();
            con2.end();
        });
    }

    /**
     * Print out the locks from the given InnoDB status string.
     * @param statement the SQL statement which was just tested
     * @param status    the output from 'SHOW ENGINE INNODB STATUS'
     */
    function logStatus(statement, status) {
        console.log('----------------------------------------');
        console.log(statement);
        console.log('----------------------------------------\n');
        console.log(findHeldLocks(status));
    }

    /**
     * Creates a function which executes the given SQL statement and gives a promise of the resulting rowset. The
     * function expects to be passed the result of a previous promise (which it ignores) and a callback to invoke
     * when the SQL has been executed.
     * @param con the MySQL connection on which to execute the SQL statement
     * @param sql the SQL statement to execute
     * @return a function which executes the SQL statement and gives a promise of the result
     */
    function bindQuery(con, sql) {
        // Ignore the result from the previous chained promise
        return Q.nbind(function(ignoredResult, cb) {
            con.query(sql, cb);
        });
    }

    /**
     * A function decorator, which given a unary function returning a promise, create another function which calls
     * fn and then returns a promise which resolves to the function's argument (instead of the promise returned by
     * fn). This is useful when building chains of promise-returning functions where you want to skip a link in the
     * chain, passing the result of an earlier function to a function further along the chain. E.g.:
     * 
     *     doA()
     *         .then(function(resultA) {
     *             return doB(resultA);
     *         }).then(function(resultB) {
     *             return doC(resultB);
     *         }).then(function(resultC) {
     *             ...
     *         });
     *
     * Becomes:
     *
     *     doA()
     *         .then(ignore(function(resultA) {
     *             return doB(resultA);
     *         })).then(function(resultA) {
     *             // we have the result of A (i.e., B was skipped)
     *             return doC(resultA);
     *         }).then(function(resultC) {
     *             ...
     *         });
     *
     * @param fn        a unary function returning a promise
     * @param thisArg   (optional) the context in which fn should be called
     * @return a function which calls fn and returns a promise which resolves to the function's argument
     */
    function ignore(fn, thisArg) {
        return function(outerResult) {
            var deferred = Q.defer();
            fn.call(thisArg, outerResult)
                .done(function onFulfilled(ignoredResult) {
                    deferred.resolve(outerResult);
                }, function onRejected(error) {
                    deferred.reject(error);
                });
            return deferred.promise;
        }
    }

    /**
     * Run a single test, by executing sql1 on con1 in parallel with executing sql2 on con2. See the diagram at top of
     * this file.
     * @param con1  the connection with which to acquire the first lock
     * @param con2  the connection with which to attempt to acquire the second lock
     * @param sql1  the SQL statement used to acquire the first lock
     * @param sql2  the SQL statement used to attempt to acquire the second lock
     * @param delay how long to wait (in ms) for con2 to block before running 'SHOW ENGINE INNODB STATUS'
     * @return a promise resolving to the result of 'SHOW ENGINE INNODB STATUS' on con1 while con2 was blocked on a lock
     */
    function runTest(con1, con2, sql1, sql2, delay) {
        return bindQuery(con1, sql1)(null)
            .then(function doAll() {
                return Q.all([
                    bindQuery(con2, sql2)(null)
                        .then(bindQuery(con2, ROLLBACK)),

                    Q.delay(delay)
                        .then(bindQuery(con1, STATUS))
                        .then(ignore(bindQuery(con1, ROLLBACK)))
                ]);
            })
            .spread(function extractStatus(result1, result2) {
                return Q(result2[0][0].Status);
            });
    }

    /**
     * @return a connection to the database, with autocommit disabled
     */
    function connect() {
        var con = mysql.createConnection(connectionDetails);
        con.connect();
        con.query('set autocommit = 0');
        return con;
    }

    /**
     * Enable the InnoDB lock monitor, which gives more detailed information on the locks held by each transaction.
     * @param a valid MySQL connection
     */
    function enableLockMonitor(con) {
        con.query('DROP TABLE IF EXISTS innodb_lock_monitor');
        con.query('CREATE TABLE innodb_lock_monitor (a INT)');
    }

    /**
     * Disable the InnoDB lock monitor.
     * @param a valid MySQL connection
     */
    function disableLockMonitor(con) {
        con.query('DROP TABLE IF EXISTS innodb_lock_monitor');
    }

    /**
     * Extract the relevant locks section from an InnoDB status string. The program searches for a transaction which
     * is a) not waiting for locks, and b) holds locks on a table named 'test'. In the unlikely event that more than
     * one transaction holds locks on a table named 'test', only the locks from the first transaction will be returned.
     * @param the output of 'SHOW ENGINE INNODB STATUS'
     * @return a description of all the locks held by the first transaction which holds locks on a table named 'test'
     */
    function findHeldLocks(status) {
        var waitingFor, holding;

        var transactions = status.split(/---TRANSACTION /).slice(1);
        for (var i = 0; i < transactions.length; i++) {
            var tx = transactions[i];

            // Truncate the junk after the last transaction
            var pos = tx.search('FILE I/O');
            if (pos >= 0) tx = tx.slice(0, pos-10);

            // Skip the transaction which is waiting for the lock
            pos = tx.search(/SEC FOR THIS LOCK TO BE GRANTED:/);
            if (pos >= 0) {
                tx = tx.slice(pos + 40);
                pos = tx.search(/------------------/);
                waitingFor = tx.slice(0, pos - 1);

            } else {
                // Extract the text from the first lock description which matches our test table
                var pos = tx.search(/(TABLE|RECORD) LOCK.*\.`test`/);
                if (pos >= 0) {
                    holding = tx.slice(pos);
                }
            }

            if (waitingFor && holding) {
                break;
            }
        }

        return holding + '\nOTHER STATEMENT BLOCKED ON:\n\n' + (waitingFor || '* NONE *\n');
    }
}());
