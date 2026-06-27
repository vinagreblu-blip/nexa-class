"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.openDatabase = openDatabase;
exports.saveNow = saveNow;
const sql_js_1 = __importDefault(require("sql.js"));
const node_fs_1 = __importDefault(require("node:fs"));
let instance = null;
let persistFn = null;
function lastInsertRowid() {
    if (!instance)
        return 0;
    const res = instance.exec('SELECT last_insert_rowid() AS id');
    if (res.length && res[0].values.length) {
        const v = res[0].values[0][0];
        return typeof v === 'bigint' ? Number(v) : v;
    }
    return 0;
}
function makeStatement(sql) {
    return {
        run(...params) {
            if (!instance)
                throw new Error('DB não inicializado');
            try {
                instance.run(sql, params);
            }
            catch (e) {
                const msg = e?.message ? e.message : String(e);
                const err = new Error(msg);
                if (/UNIQUE constraint/i.test(msg))
                    err.code = 'SQLITE_CONSTRAINT_UNIQUE';
                throw err;
            }
            const changes = instance.getRowsModified();
            const id = lastInsertRowid();
            persistFn?.();
            return { changes, lastInsertRowid: id };
        },
        get(...params) {
            if (!instance)
                throw new Error('DB não inicializado');
            const stmt = instance.prepare(sql);
            let row;
            if (params.length) {
                stmt.bind(params);
                if (stmt.step())
                    row = stmt.getAsObject();
            }
            else {
                if (stmt.step())
                    row = stmt.getAsObject();
            }
            stmt.free();
            return row;
        },
        all(...params) {
            if (!instance)
                throw new Error('DB não inicializado');
            const stmt = instance.prepare(sql);
            const rows = [];
            if (params.length)
                stmt.bind(params);
            while (stmt.step())
                rows.push(stmt.getAsObject());
            stmt.free();
            return rows;
        },
    };
}
async function openDatabase(dbPath) {
    const SQL = await (0, sql_js_1.default)();
    if (node_fs_1.default.existsSync(dbPath)) {
        instance = new SQL.Database(node_fs_1.default.readFileSync(dbPath));
    }
    else {
        instance = new SQL.Database();
    }
    persistFn = () => {
        if (!instance)
            return;
        node_fs_1.default.writeFileSync(dbPath, Buffer.from(instance.export()));
    };
    instance.run('PRAGMA foreign_keys = ON');
    const adapter = {
        prepare: (sql) => makeStatement(sql),
        exec: (sql) => {
            if (!instance)
                throw new Error('DB não inicializado');
            instance.exec(sql);
            persistFn?.();
        },
        pragma: (_s) => {
            /* no-op: sql.js roda em memória (WASM) */
        },
    };
    return adapter;
}
function saveNow() {
    persistFn?.();
}
//# sourceMappingURL=sqlite-adapter.js.map