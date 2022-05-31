import Postgres from './Postgres';
import cluster from 'cluster';
import { cpus } from 'os';
import { asyncSleep } from './Postgres';


console.log(cluster.isPrimary);

let readTest = 'mixed';

if (cluster.isPrimary) {
    for (let i = 0; i < cpus().length; i++) {
        cluster.fork();
    }

    process.on('uncaughtException', (err: Error, origin: string) => {
        console.log(err.message);
    });

} else {
    Postgres.Init(11);
    (async () => {
        await asyncSleep(3000);
        let t = 0;

        switch (readTest) {
            case 'read':
                const ppr = 's';
                const pr = 'SELECT * FROM pgbench_accounts WHERE aid=$1;';

                t = Date.now(); for (let i = 0; i < 200000; i++) {
                    (async () => {
                        await Postgres.query(ppr, pr, [~~(Math.random() * 99999)]);
                        if (i == 199999)
                            console.log(Date.now() - t);
                    })();
                }
                t = Date.now();
                break;
            case 'write':
                const ppw = 's';
                const pw = 'UPDATE pgbench_accounts SET abalance=$2,bid=$3 WHERE aid=$1;';
                t = Date.now(); for (let i = 0; i < 200000; i++) {
                    (async () => {
                        await Postgres.query(ppw, pw, [~~(Math.random() * 99999), ~~(Math.random() * 99999), ~~(Math.random() * 99999)]);
                        if (i == 199999)
                            console.log(Date.now() - t);
                    })();
                }
                t = Date.now();
                break;
            case 'mixed':
                const ppm = 's';
                const pm = 'UPDATE pgbench_accounts SET abalance=$2,bid=$3 WHERE aid=$1 RETURNING abalance, bid, aid;';
                t = Date.now(); for (let i = 0; i < 200000; i++) {
                    (async () => {
                        await Postgres.query(ppm, pm, [~~(Math.random() * 99999), ~~(Math.random() * 99999), ~~(Math.random() * 99999)]);
                        if (i == 199999)
                            console.log(Date.now() - t);
                    })();
                }
                t = Date.now();
                break;
        }
    })();
}
