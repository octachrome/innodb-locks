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

var delay = 50;

var statements = [
    'DELETE FROM test',
    'DELETE FROM test where a < 5'
];

run_tests(statements, delay);


function run_tests(statements, delay) {
    var con1 = connect();
    var con2 = connect();

    enableLockMonitor(con1);

    var promise = Q();

    for (var i = 0; i < statements.length; i++) {
        var statement = statements[i];

        promise = promise.then(function() {
            return run_test(con1, con2, statement, statement, delay);
        }).then(log_status);
    }

    promise.done(function() {
        disableLockMonitor(con1);
        con1.end();
        con2.end();
    });
}

function log_status(status) {
    var matches = status.match(/^.*lock.*$/mg);
    for (var i = 0; i < matches.length; i++) {
        console.log(matches[i]);
    }
}

// Returns a function which executes the given SQL statement and returns a promise of the result.
// The function expects to be passed the result of a previous promise (which it ignores) and a callback to invoke when the SQL has been executed.
function bind_query(con, sql) {
    // Ignore the result from the previous chained promise
    return Q.nbind(function(ignored_result, cb) {
        con.query(sql, cb);
    });
}

// Given a function, fn, which returns a promise, return a function which calls fn but ignores its result.
// The function instead chains the previous promise.
function ignore(fn, thisArg) {
    return function(outer_result) {
        var deferred = Q.defer();
        fn.call(thisArg, outer_result)
            .done(function onFulfilled(ignored_result) {
                deferred.resolve(outer_result);
            }, function onRejected(error) {
                deferred.reject(error);
            });
        return deferred.promise;
    }
}

function run_test(con1, con2, sql1, sql2, delay) {
    return bind_query(con1, sql1)(null)
        .then(function do_all() {
            return Q.all([
                bind_query(con2, sql2)(null)
                    .then(bind_query(con2, ROLLBACK)),

                Q.delay(delay)
                    .then(bind_query(con1, STATUS))
                    .then(ignore(bind_query(con1, ROLLBACK)))
            ]);
        })
        .spread(function show_result(result1, result2) {
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
