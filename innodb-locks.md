
## Types of lock ##

Row-level locks and table-level locks. If you don't explicitly lock tables, you don't need to worry about table locks.

## Table locks ##

There are three varieties of table locks. Regular locks, intention locks, and auto-increment locks. Regular locks lock the table to prevent other people locking the table.

## Regular table locks ##

This is the simplest kind of locking. If I lock a table, you can't insert into it, you can't delete from it. There are two kinds of regular table lock: shared and exclusive.

An exclusive lock prevents anyone else from aquiring any other kind of lock on the table whatsoever. A shared lock allows other people to also aquire shared locks, but it prevents anyone else from aquiring an exlusive lock.

Shared locks are also known as read locks, because you typically use one if you want to read some data and then be sure that no one else changes the data until you are finished with it. You don't mind other people reading it though, so the lock is shared. You get one like this:

    LOCK TABLES kittens READ;

Exclusive locks are also known as write locks. If you are going to write to something, you don't want anyone else writing to it, and you don't want anyone reading it until you are finished. You get one like this:

    LOCK TABLES kittens WRITE;

Here's a compatibility matrix:

Lock held | Lock wanted | Granted?
----------|-------------|---------
S | S | Yes
S | X | No
X | S | No
X | X | No

Shared and exclusive locks are commonly used in many database systems.

## Intention locks ##

Whenever a row-level lock is acquired, you also acquire an **intention lock** on the table. This prevents someone from locking a single row within a table which is already locked as a whole by someone else, and vice versa.

  X     IX      S     IS
X Conflict  Conflict  Conflict  Conflict
IX  Conflict  Compatible  Conflict  Compatible
S Conflict  Conflict  Compatible  Compatible
IS  Conflict  Compatible  Compatible  Compatible

Intention shared (IS): Transaction T intends to set S locks on individual rows in table t.
Intention exclusive (IX): Transaction T intends to set X locks on those rows.

Before a transaction can acquire an S lock on a row in table t, it must first acquire an IS or stronger lock on t.
Before a transaction can acquire an X lock on a row, it must first acquire an IX lock on t.

Intention locks should not be confused with insert intention locks, which are a kind of row-level lock (see below).

## Record locks ##

An InnoDB table is a collection of indexes. An index is an associative array implemented using a B+Tree. The clustered index maps the primary keys to the data for each row of the table. Secondary indexes map other keys to primary keys, so a row look-up via a secondary index is two look-ups: one to map the secondary key to the PK, and one to map the PK to the row data.

Indexes store their data in key order, which optimizes things like searching for all keys greater than K in ascending order. In addition to this natural ordering of the keys, the records in an index are also assigned a heap number, which shows the order in which they were added to the index. Each index contains two special records: the infimum and the supremum. The infimum is less than all other keys in the index, and has heap no 0. The supremum is greater than all other keys in the index and has heap no 1.

When we talk about record locks, the thing which is locked is an index record: an entry in the primary index or in a secondary index. The supremum record can be locked, as we will see later.

## Types of record lock ##

There are four common varieties of lock.

**Ordinary** locks, aka **next-key** locks, lock an index record and the gap between this index record and its predecessor. They look like this:

    RECORD LOCKS space id 0 page no 307 n bits 72 index `PRIMARY` of table `test`.`test` trx id 503 lock_mode X
    Record lock, heap no 2 PHYSICAL RECORD: n_fields 4; compact format; info bits 0

**Record** locks, aka **rec-not-gap** locks, lock an index record only. They look like this:

    RECORD LOCKS space id 0 page no 307 n bits 72 index `PRIMARY` of table `test`.`test` trx id 503 lock_mode X locks rec but not gap
    Record lock, heap no 2 PHYSICAL RECORD: n_fields 4; compact format; info bits 0

**Gap** locks lock the gap between two index records only, but not the records themselves. They look like this:

    RECORD LOCKS space id 0 page no 307 n bits 72 index `PRIMARY` of table `test`.`test` trx id 503 lock_mode X locks gap before rec
    Record lock, heap no 2 PHYSICAL RECORD: n_fields 4; compact format; info bits 0

However, if a gap lock is held on the gap before the supremum record (heap no 1), it will appear as an ordinary lock:

    RECORD LOCKS space id 0 page no 307 n bits 72 index `PRIMARY` of table `test`.`test` trx id 50F lock_mode X
    Record lock, heap no 1 PHYSICAL RECORD: n_fields 1; compact format; info bits 0

**Insert intention** or **insert intent** locks also lock the gap only. They look like this:

    RECORD LOCKS space id 0 page no 307 n bits 72 index `PRIMARY` of table `test`.`test` trx id 503 lock_mode X locks gap before rec insert intention
    Record lock, heap no 2 PHYSICAL RECORD: n_fields 4; compact format; info bits 0

If an insert intention lock is held on the gap before the supremum record (heap no 1), it looks like this instead:

    RECORD LOCKS space id 0 page no 307 n bits 72 index `PRIMARY` of table `test`.`test` trx id 50F lock_mode X insert intention
    Record lock, heap no 1 PHYSICAL RECORD: n_fields 1; compact format; info bits 0

Each variety of lock can occur in two modes: shared (S) and exclusive (X).

What sorts of operations create what sort of locks?

Statement | Isolation level | Lock
----------|-----------------|------
insert    | Repeatable read | 


Lock compatibility.

Can the supremum of a non-root page ever be locked? Are heap nos unique within a page or within an index?


Gap             Y                     Y             Y
Gap (intent)    Y       Y             Y             Y
Rec-not-gap     Y       Y
Ordinary        Y







TABLE LOCK table `test`.`test` trx id 503 lock mode IX
RECORD LOCKS space id 0 page no 307 n bits 72 index `PRIMARY` of table `test`.`test` trx id 503 lock_mode X locks rec but not gap
Record lock, heap no 2 PHYSICAL RECORD: n_fields 4; compact format; info bits 0
 0: len 4; hex 80000001; asc     ;;
 1: len 6; hex 000000000503; asc       ;;
 2: len 7; hex 84000001340110; asc     4  ;;
 3: len 4; hex 80000001; asc     ;;



mysql> select * from information_schema.innodb_locks;
+-------------+-------------+-----------+-----------+---------------+------------+------------+-----------+----------+-----------+
| lock_id     | lock_trx_id | lock_mode | lock_type | lock_table    | lock_index | lock_space | lock_page | lock_rec | lock_data |
+-------------+-------------+-----------+-----------+---------------+------------+------------+-----------+----------+-----------+
| 506:0:307:2 | 506         | S         | RECORD    | `test`.`test` | `PRIMARY`  |          0 |       307 |        2 | 1         |
| 503:0:307:2 | 503         | X         | RECORD    | `test`.`test` | `PRIMARY`  |          0 |       307 |        2 | 1         |
+-------------+-------------+-----------+-----------+---------------+------------+------------+-----------+----------+-----------+
2 rows in set (0.00 sec)


Mode of the lock. One of S, X, IS, IX, S_GAP, X_GAP, IS_GAP, IX_GAP, or AUTO_INC for shared, exclusive, intention shared, intention exclusive row locks, shared and exclusive gap locks, intention shared and intention exclusive gap locks, and auto-increment table level lock,










select * from test for update
------- TRX HAS BEEN WAITING 15 SEC FOR THIS LOCK TO BE GRANTED:
RECORD LOCKS space id 0 page no 307 n bits 72 index `PRIMARY` of table `test`.`test` trx id 50C lock_mode X waiting
Record lock, heap no 2 PHYSICAL RECORD: n_fields 4; compact format; info bits 0
 0: len 4; hex 80000001; asc     ;;
 1: len 6; hex 000000000503; asc       ;;
 2: len 7; hex 84000001340110; asc     4  ;;
 3: len 4; hex 80000001; asc     ;;

------------------
TABLE LOCK table `test`.`test` trx id 50C lock mode IX
RECORD LOCKS space id 0 page no 307 n bits 72 index `PRIMARY` of table `test`.`test` trx id 50C lock_mode X
Record lock, heap no 4 PHYSICAL RECORD: n_fields 4; compact format; info bits 0
 0: len 4; hex 80000000; asc     ;;
 1: len 6; hex 000000000508; asc       ;;
 2: len 7; hex 89000001380110; asc     8  ;;
 3: len 4; hex 80000000; asc     ;;

RECORD LOCKS space id 0 page no 307 n bits 72 index `PRIMARY` of table `test`.`test` trx id 50C lock_mode X waiting
Record lock, heap no 2 PHYSICAL RECORD: n_fields 4; compact format; info bits 0
 0: len 4; hex 80000001; asc     ;;
 1: len 6; hex 000000000503; asc       ;;
 2: len 7; hex 84000001340110; asc     4  ;;
 3: len 4; hex 80000001; asc     ;;

+-------------+-------------+-----------+-----------+---------------+------------+------------+-----------+----------+-----------+
| lock_id     | lock_trx_id | lock_mode | lock_type | lock_table    | lock_index | lock_space | lock_page | lock_rec | lock_data |
+-------------+-------------+-----------+-----------+---------------+------------+------------+-----------+----------+-----------+
| 50C:0:307:2 | 50C         | X         | RECORD    | `test`.`test` | `PRIMARY`  |          0 |       307 |        2 | 1         |
| 503:0:307:2 | 503         | X         | RECORD    | `test`.`test` | `PRIMARY`  |          0 |       307 |        2 | 1         |
+-------------+-------------+-----------+-----------+---------------+------------+------------+-----------+----------+-----------+




//////
select * from test for update
TABLE LOCK table `test`.`test` trx id 50F lock mode IX
RECORD LOCKS space id 0 page no 307 n bits 72 index `PRIMARY` of table `test`.`test` trx id 50F lock_mode X
Record lock, heap no 1 PHYSICAL RECORD: n_fields 1; compact format; info bits 0
 0: len 8; hex 73757072656d756d; asc supremum;;

Record lock, heap no 3 PHYSICAL RECORD: n_fields 4; compact format; info bits 0
 0: len 4; hex 80000002; asc     ;;
 1: len 6; hex 000000000507; asc       ;;
 2: len 7; hex 88000001370110; asc     7  ;;
 3: len 4; hex 80000002; asc     ;;

Record lock, heap no 4 PHYSICAL RECORD: n_fields 4; compact format; info bits 0
 0: len 4; hex 80000000; asc     ;;
 1: len 6; hex 000000000508; asc       ;;
 2: len 7; hex 89000001380110; asc     8  ;;
 3: len 4; hex 80000000; asc     ;;

holds 3 record locks in page 307


select * from test for update
------- TRX HAS BEEN WAITING 27 SEC FOR THIS LOCK TO BE GRANTED:
RECORD LOCKS space id 0 page no 307 n bits 72 index `PRIMARY` of table `test`.`test` trx id 510 lock_mode X waiting
Record lock, heap no 4 PHYSICAL RECORD: n_fields 4; compact format; info bits 0
 0: len 4; hex 80000000; asc     ;;
 1: len 6; hex 000000000508; asc       ;;
 2: len 7; hex 89000001380110; asc     8  ;;
 3: len 4; hex 80000000; asc     ;;

------------------
TABLE LOCK table `test`.`test` trx id 510 lock mode IX
RECORD LOCKS space id 0 page no 307 n bits 72 index `PRIMARY` of table `test`.`test` trx id 510 lock_mode X waiting
Record lock, heap no 4 PHYSICAL RECORD: n_fields 4; compact format; info bits 0
 0: len 4; hex 80000000; asc     ;;
 1: len 6; hex 000000000508; asc       ;;
 2: len 7; hex 89000001380110; asc     8  ;;
 3: len 4; hex 80000000; asc     ;;


IX and IX are compatible, so they both hold it
X is incompatible, so tx2 blocks (on X) waiting for record lock on heap 4
I guess it will try to acquire a lock on heaps 1 and 3 afterwards
(there is no conflict between the table-level lock and the record-level lock;
table locks only conflict with table locks, and record locks only with record locks)



Sorts of lock which are being waited for (all RECORD):
X insert intention waiting
X locks gap before rec insert intention waiting
X locks rec but not gap waiting
X waiting


Sorts of record lock which are held:

lock mode S*
lock mode S locks gap before rec
lock mode S locks rec but not gap
lock_mode X*
lock_mode X insert intention**
lock_mode X insert intention waiting**
lock_mode X locks gap before rec
lock_mode X locks gap before rec insert intention waiting
lock_mode X locks rec but not gap
lock_mode X locks rec but not gap waiting
lock_mode X waiting*

* if these are on supremum records, then they are gap locks, NOT next-key locks
  (although, if they are waiting, this implies that they are not gap locks)
** these are ALL supremum records, and therefore gap locks (but without the gap flag set)

Sorts of table lock which are held:
lock mode AUTO-INC waiting*
lock mode AUTO-INC
lock mode IS
lock mode IX

* only on batch_updates table

Types of statement:
update where
delete from where
insert



Perhaps it doesn't matter so much. The main points are:
  if you are blocked on a record lock, whoever else holds the record lock is likely to be blocking you, regardless of the lock type
  this could be several people (in the case where they hold S locks and you want an X)
  table locks are not an issue for us (no one ever blocked on them in nestle log or dev log)


blocked on S
	someone must hold X, and it can only be one person
	no one else can hold S, otherwise X could not be held
blocked on X
	either, someone else holds X, and no one else holds anything
	or, one or more people hold S



a record lock is one of: LOCK_ORDINARY, LOCK_GAP, LOCK_REC_NOT_GAP
what's the difference between LOCK_ORDINARY and LOCK_REC_NOT_GAP?
LOCK_INSERT_INTENTION can be or'ed with LOCK_GAP and with LOCK_ORDINARY

Ordinary = Next-Key Lock in the manual
LOCK_GAP = gap only
LOCK_REC_NOT_GAP = record only
insert intent = LOCK_GAP & LOCK_INSERT_INTENTION

Facebook blog page said that insert intent is "a shared lock on the gap between 3 and 6 and an exclusive lock on the value to be inserted"
I think this means the insert intent lock does not block other gap locks (i.e., it is "shared"), and the insert then also acquires an X lock (a record lock, not an insert intention)


Implicit and explicit locks. Only explicit are listed in the lock monitor. Implicit locks only affect the record, not the gap (supposedly).
They are calculated rather than stored, by methods in lock0lock.c
I think implicit gets promoted to explicit when someone blocks on it.


Sounds like lots of transactions can hold an "intent to insert" lock for the same gap.


 #define LOCK_ORDINARY 0   /* this flag denotes an ordinary next-key lock in contrast to LOCK_GAP or LOCK_REC_NOT_GAP */
  #define LOCK_GAP 512 /* this gap bit should be so high that it can be ORed to the other
flags; when this bit is set, it means that the lock holds only on the
gap before the record; for instance, an x-lock on the gap does not
give permission to modify the record on which the bit is set; locks of
this type are created when records are removed from the index chain of
records */
  #define LOCK_REC_NOT_GAP 1024
/* this bit means that the lock is only on the index record and does
NOT block inserts to the gap before the index record; this is used in
the case when we retrieve a record with a unique key, and is also used
in locking plain SELECTs (not part of UPDATE or DELETE) when the user
has set the READ COMMITTED isolation level */
  #define LOCK_INSERT_INTENTION 2048
/* this bit is set when we place a waiting gap type record lock
request in order to let an insert of an index record to wait until
there are no conflicting locks by other transactions on the gap; note
that this flag remains set when the waiting lock is granted, or if the
lock is inherited to a neighboring record */



MySQL manual on intention locks states that these are table-level locks, but they clearly can be record locks too
* there is a confusing difference between "insert intention" (record-level) and "intention locks" (table-level)


...the gap locks acquired by DELETE statements are of the purely "inhibitive" variety.
The DELETE gap lock blocks INSERT statements (which acquire "insert intention" locks), but do not block other DELETE X-locks.

'gap' locks in InnoDB are purely 'inhibitive': they block inserts to the
locked gap. But they do not give the holder of the lock any right to
insert. Several transactions can own X-lock on the same gap. The reason

So, whatever, gap locks are blockers, just like all the other locks.

Question: can I get a gap-only lock on a record if someone else holds a record-only lock on it?
Answer: yes



I think:
  If A holds a gap lock, or a next-key lock (i.e., record and gap), this prevents B inserting into the gap
  because B would have to acquire an insert intention gap lock before doing the insert, which would conflict

  If B went first, they would acquire the insert intention gap lock, perform the insert, then release the insert intention gap lock again.
  The insert intention purely ensures that A's delete is interleaved correctly with B's insert. B and C could get insert intentions at the same
  time, because concurrent inserts are not a problem, and should be optimised for high throughput.

  (I now know that the insert intention lock is not released, rather it does not block a regular gap lock)


A   insert into test values(5,5);
B   insert into test values(5,5);

//  hopefully, B now holds an intention lock on the gap below 7
//  nope, B immediately fails with a duplicate key error

A   delete from test where i = 6;

//  will it block???



could make an insert block by deleting an FK row it depends on
yes, but the delete is not blocking on it. it appears that the insert blocks on acquiring an S lock on the foreign row,
but no intention lock is shown. other transactions can happily delete (acquiring a lock on the gap which I thought would be locked by the intention lock)


if I insert a row and then delete it in another transaction, the delete blocks waiting for a "rec but not gap" lock.
I thought deletes created next key locks - is the lock acquired in two phases?

"Because an INSERT is always adding a row to a gap, the transaction will acquire an "insert intention exclusive lock" on the gap,
which means that UPDATEs or DELETEs for the gap will block, but other INSERTs that do not insert into the same row will not block."
- I cannot see this behaviour, which makes me think the intention lock is transient.


I think that these combinations are valid:
  LOCK_ORDINARY
  LOCK_GAP
  LOCK_REC_NOT_GAP
  LOCK_ORDINARY | LOCK_INSERT_INTENTION
  LOCK_GAP | LOCK_INSERT_INTENTION

reading lock0lock.c implies that:
  incompatible gap locks can be held (i.e., S and X), so long as they are not insert intention
  no one needs to wait for a gap lock (except insert intention locks)
  no sort of gap lock (inc insert intention) needs to wait for a rec_not_gap
  nothing needs to wait for an insert intention lock of any sort



(remember that supremem locks are always gap locks, even if not displayed as such)

there is some asymmetry, because delete and insert into gap block in one order but not in the other
(i.e., the gap lock of the delete blocks the subsequent intention lock of the insert, but not vice versa)
I guess locks are not just for transactions, but also for interleaving of operations (heap creation, etc.),
so they may be transient.


	                        		Lock desired
Lock held       Gap     Gap (intent)  Rec-not-gap   Ordinary
Gap             Y                     Y             Y
Gap (intent)    Y       Y             Y             Y
Rec-not-gap	    Y       Y
Ordinary        Y

Y = lock is granted, regardless of compatibility
otherwise, lock is granted, so long as compatible (S vs X)

Matches up with what I read elsewhere (table is pivoted, and exclude [ordinary intention]):

  G I R N (already existing lock, comprising a lock wait) 
G + + + + 
I - + + - 
R + + - 
N + + - 


In summary:
  Record locks (either next-key or rec-not-gap) wait on other record locks (perhaps several, in the case of X locks waiting for >1 S)
  Intention locks wait on other non-intention gap locks (either next-key or gap before rec) (but S vs X should still be checked)

So:
  Record what sort of lock is held on each record (X or S) - don't care if it is rec only or next key
  Record what sort of non-intention lock is held on each gap (X or S) don't care if it is gap before only or next key
  No point recording intention locks held, because they don't block anything
  Record ALL *waiting* locks in detail
  Scan for every record/gap involved in a lock and record these as separate entries
  Apply lock type conversions for supremum records
  Validate assumptions about supremum locks
  If the "Record lock" lines are missing, assume that the bitmap is clear (lock structure is empty but not yet purged)
  Read the lock0lock.c file comment



Found another Nestlé issue where many transactions are waiting for the AUTO-INC lock for batch_updates.
The tx which holds it is waiting for the insert intention gap lock for the same insert operation, which is probably held by someone deleting from the table (not clear from logs).
Solved in 5.1.22 by holding the auto-inc lock for less time.

