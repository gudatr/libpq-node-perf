# pg-pool-minimal
A simple pool implementation for postgresql with lightweight client code and helper functions.
Pooling is done automatically but it allows you to take control for transactions.
Since v1.2.0 the client is merely a single layer on top of the native bindings to libpq.
Since v1.3.0 the client skips column name and type parsing for prepared queries.

## Installation

### Prerequisites

The package libpq that provides the native bindings, requires the PostgreSQL client libraries & tools. To validate them, check if the command pg_config is known to your machine. If not, take the following steps:

#### MacOS

```
brew install libpq
```

If necessary, search with:
```
sudo find / -name "pg_config" -print
```

Then add the result to your shell file, e.g.:
```
echo 'export PATH="/opt/homebrew/Cellar/libpq/15.2/bin:$PATH"' >> ~/.zshrc
```

#### Ubuntu/Debian:

```
apt-get install libpq-dev g++ make
```

#### RHEL/CentOS:

```
yum install postgresql-devel
```

#### Windows:

Install PostgreSQL (http://www.postgresql.org/download/windows/) and add your PostgreSQL installation's bin folder to the system path (e.g. C:\Program Files\PostgreSQL\X.X\bin). Make sure that both libpq.dll and pg_config.exe are in that folder.


### Package

Once the tools are installed, install the package:

```
npm install pg-pool-minimal
```

## Usage

### Initialization

```javascript
let pool = new Postgres({
        user: 'postgres',
        host: '127.0.0.1',
        port: 5432,
        database: 'template1',
        schema: 'public',
        socket: '/var/run/postgresql/',
        password: '',
        threads: 10,
        queueSize: 200000,
        escapeChar: '\\',
        valuesOnly: false,
        alwaysLoadResultInfo: false
});

await pool.initialize();
```

By default queries will return objects mapping column name to value. If you want the queries to only return an array of values instead of said object (column order will be guaranteed), you can set valuesOnly to true.

If you do not want to or can use a unix socket, leave the socket parameter undefined.

The queueSize defines the internal command queue of the pool.

### Prepared Query

```javascript
let items: Item[] = await pool.query("get-player-items", "SELECT * FROM items WHERE player_id=$1", [player_id]);
```
Note: You do not have to supply a parameter, an empty [] array will do then

### Simple String Query, no preparation

```javascript
let players: Player[] = await pool.queryString("SELECT * FROM players");
```

### Affected rows

Using the function queryCount and queryStringCount you can, instead of making the client parse a query result, simply get the number of affected rows.

### Transactions

Performing transactions requires you to use the same client.
Use the connect function to aquire one and execute your queries.
Make sure to finally release the client to the pool soo it does not clog and die horribly.

```javascript
let client = await pool.connect();
try{
    await client.queryString('START TRANSACTION ISOLATION LEVEL SERIALIZABLE;');
    await client.query('update','UPDATE users SET value=$1',[100]);
    await client.queryString('COMMIT');
} catch(error){
    //Handle error
    await client.queryString('ROLLBACK');
} finally{
    client.release();
}
```

## Useful tooling

### Escaping

In case you want to allow searches based on user input in your backend, using LIKE '%userinput%' for example,
you can escape the input using

```javascript
let escaped = pool.escapeWildcards(input)
```

This will escape characters that would otherwise be considered as patterns.
You can define your escape character in the ClientConfig of the pool constructor.

### Prepare Identifiers

You can choose names for your prepared queries of course, but normally you would not care about the concrete name.
You can generate an alias for your query that is unique and as small as possible

```javascript
let identifier = pool.getPrepareIdentifier();
```

Example usage:

```javascript
const getAllItemsName = Pool.getPrepareIdentifier();
const getAllItemsQuery = "SELECT * FROM items WHERE player_id=$1";

function getItemsForPlayer(player_id: number){
    items : Item[] = await pool.query(getAllItemsName, getAllItemsQuery, [player_id]);
}
```


