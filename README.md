# Postgres Pool
A simple and lightweight pool implementation for postgresql.
Pooling is done automatically but it allows you to take control for transactions.

## Usage

### Initialization
```javascript
let pool = new Postgres({
        user: 'postgres',
        host: '127.0.0.1',
        port: 5432,
        database: 'db',
        schema: 'public',
        socket: '/var/run/postgresql/', 
        password: 'pass',
        threads: 10,
        queueSize: 65535,
        escapeChar: '\\'
});

await pool.initialize();
```

Note: The queueSize defines the internal command queue of the pool.
If this sample value is not enough you might have a bottleneck somewhere else.

### Prepared Query (default and recommended)
```javascript
let items: Item[] = await pool.query("get-player-items", "SELECT * FROM items WHERE player_id=$1", [player_id]);
```
Note: You do not have to supply a parameter, an empty [] array will do then

### Simple String Query, no preparation
```javascript
let players: Player[] = await pool.queryString("SELECT * FROM players");
```

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


