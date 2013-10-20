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

var sql1 = 'DELETE FROM test';
var sql2 = 'DELETE FROM test';
var ROLLBACK = 'ROLLBACK';
var STATUS = 'SHOW ENGINE INNODB STATUS';

var delay = 50;

var conDetails = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'test'
};

var con1 = mysql.createConnection(conDetails);
con1.connect();
con1.query('DROP TABLE IF EXISTS innodb_lock_monitor')
con1.query('CREATE TABLE innodb_lock_monitor (a INT)')
con1.query('set autocommit = 0');

var con2 = mysql.createConnection(conDetails);
con2.connect();
con2.query('set autocommit = 0');

run_test(con1, con2, sql1, sql2, delay)
    .done(function(status) {
        console.log(status);
        con1.query('DROP TABLE IF EXISTS innodb_lock_monitor')
        con1.end();
        con2.end();
    });

// Returns a function which executes the given SQL statement and returns a promise of the result.
// The function expects to be passed the result of a previous promise (which it ignores) and a callback to invoke when the SQL has been executed.
function bind_query(con, sql) {
    // Ignore the result from the previous chained promise
    return Q.nbind(function(ignored_result, cb) {
        con.query(sql, cb);
    });
};

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
