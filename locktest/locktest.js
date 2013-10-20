/*
    Open two connections, both with autocommit = 0
    In parallel:

    Connection 1:                                       Connection 2:
    Run a statment which acquires a lock
                                                        Run a statement which blocks on the lock
    Run 'SHOW ENGINE INNODB STATUS'
    Rollback
                                                        Rollback

    con1.acquire
     \
      con2.block
                \
                 rollback
      sleep
       \
        con1.status
         \
          rollback
*/

'use strict';

var Q = require('q');
var mysql = require('mysql');

Q.longStackSupport = true;

var ROLLBACK = 'ROLLBACK';
var STATUS = 'SHOW ENGINE INNODB STATUS';

var statements = [
    'DELETE FROM test',
    'DELETE FROM test WHERE a < 5',
    'DELETE FROM test WHERE a = 2'
];

runTests(statements, 50);


function runTests(statements, delay) {
    var con1 = connect();
    var con2 = connect();

    enableLockMonitor(con1);

    var promise = Q();

    for (var i = 0; i < statements.length; i++) {
        var statement = statements[i];

        promise = promise.then(function runOneTest() {
            return runTest(con1, con2, statement, statement, delay);
        }).then(logStatus);
    }

    promise.done(function tearDown() {
        disableLockMonitor(con1);
        con1.end();
        con2.end();
    });
}

function logStatus(status) {
    var matches = status.match(/^.*lock.*$/mg);
    for (var i = 0; i < matches.length; i++) {
        console.log(matches[i]);
    }
}

// Returns a function which executes the given SQL statement and returns a promise of the result.
// The function expects to be passed the result of a previous promise (which it ignores) and a callback to invoke when the SQL has been executed.
function bindQuery(con, sql) {
    // Ignore the result from the previous chained promise
    return Q.nbind(function(ignoredResult, cb) {
        con.query(sql, cb);
    });
}

// Given a function, fn, which returns a promise, return a function which calls fn but ignores its result.
// The function instead chains the previous promise.
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

function connect() {
    var conDetails = {
        host: 'localhost',
        user: 'root',
        password: '',
        database: 'test'
    };

    var con = mysql.createConnection(conDetails);
    con.connect();
    con.query('set autocommit = 0');
    return con;
}

function enableLockMonitor(con) {
    con.query('DROP TABLE IF EXISTS innodb_lock_monitor')
    con.query('CREATE TABLE innodb_lock_monitor (a INT)')
}

function disableLockMonitor(con) {
    con.query('DROP TABLE IF EXISTS innodb_lock_monitor')
}
