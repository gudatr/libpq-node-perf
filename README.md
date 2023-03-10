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
        database: 'database',
        schema: 'public',
        socket: true, 
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

### Simple String Query
```javascript
let players: Player[] = pool.queryString("SELECT * FROM players");
```

### Transaction
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
let escaped = pool.EscapeWildcards(input)
```
This will escape characters that would otherwise be considered as patterns.
You can define your escape character in the ClientConfig

### Prepare Identifiers
You can choose names for your prepared queries of course, but normally you would not care about the concrete name.
You can generate an alias for your query that is unique and as small as possible using
```javascript
let identifier = pool.GetPrepareIdentifier();
```

Example usage:
```javascript
const GetAllItemsName = Pool.GetPrepareIdentifier();
const GetAllItemsQuery = "SELECT * FROM items WHERE player_id=$1";

function GetItemsForPlayer(player_id: number){
    items : Item[] = await pool.query(GetAllItemsName, GetAllItemsQuery, [player_id]);
}
```


