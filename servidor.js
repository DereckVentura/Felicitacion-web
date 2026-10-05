const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");
const path = require("path");
const os = require("os");

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");

function obtenerIpLocal() {
    const interfaces = os.networkInterfaces();
    const ips = [];

    for (const nombre in interfaces) {
        for (const detalle of interfaces[nombre]) {
            if (detalle.family === "IPv4" && !detalle.internal) {
                ips.push(detalle.address);
            }
        }
    }

    return ips[0] || "127.0.0.1";
}

function construirUrl(req, ruta) {
    if (PUBLIC_URL) {
        return `${PUBLIC_URL}${ruta}`;
    }

    const hostHeader = (req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`).split(",")[0].trim();
    const protocolo = req.headers["x-forwarded-proto"] || req.protocol || "http";

    const host = hostHeader === `localhost:${PORT}` || hostHeader === `127.0.0.1:${PORT}` ?
        `${obtenerIpLocal()}:${PORT}` :
        hostHeader;

    return `${protocolo}://${host}${ruta}`;
}

// Permitir recibir datos grandes
app.use(express.json({ limit: "20mb" }));

// Servir archivos de la carpeta public
app.use(express.static(path.join(__dirname, "public")));

// Crear / abrir base de datos
const db = new sqlite3.Database("./felicitaciones.db");

// Crear tabla si no existe
db.run(`
    CREATE TABLE IF NOT EXISTS felicitaciones (
        id TEXT PRIMARY KEY,
        carta TEXT,
        foto1 TEXT,
        foto2 TEXT,
        foto3 TEXT,
        foto4 TEXT,
        foto5 TEXT,
        fecha TEXT
    )
`);

// ===============================
// CREAR FELICITACIÓN
// ===============================

app.post("/api/felicitaciones", (req, res) => {

    const {
        carta,
        fotos
    } = req.body;

    // Crear ID aleatorio
    const id = crypto.randomBytes(5).toString("hex");

    const listaFotos = fotos || [];

    const foto1 = listaFotos[0] || "";
    const foto2 = listaFotos[1] || "";
    const foto3 = listaFotos[2] || "";
    const foto4 = listaFotos[3] || "";
    const foto5 = listaFotos[4] || "";

    const fecha = new Date().toISOString();

    const sql = `
        INSERT INTO felicitaciones
        (id, carta, foto1, foto2, foto3, foto4, foto5, fecha)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(
        sql, [
            id,
            carta || "",
            foto1,
            foto2,
            foto3,
            foto4,
            foto5,
            fecha
        ],
        function(error) {

            if (error) {
                console.error(error);

                return res.status(500).json({
                    correcto: false,
                    mensaje: "No se pudo guardar la felicitación."
                });
            }

            res.json({
                correcto: true,
                id: id,
                ver: construirUrl(req, `/ver.html?id=${id}`),
                editar: construirUrl(req, `/editar.html?id=${id}`)
            });
        }
    );
});

// ===============================
// OBTENER FELICITACIÓN
// ===============================

app.get("/api/felicitaciones/:id", (req, res) => {

    const id = req.params.id;

    const sql = `
        SELECT *
        FROM felicitaciones
        WHERE id = ?
    `;

    db.get(sql, [id], (error, fila) => {

        if (error) {
            console.error(error);

            return res.status(500).json({
                mensaje: "Error al consultar la felicitación."
            });
        }

        if (!fila) {
            return res.status(404).json({
                mensaje: "No se encontró la felicitación."
            });
        }

        res.json({
            id: fila.id,
            carta: fila.carta,
            fotos: [
                fila.foto1,
                fila.foto2,
                fila.foto3,
                fila.foto4,
                fila.foto5
            ].filter(foto => foto !== "")
        });
    });
});

// ===============================
// EDITAR FELICITACIÓN
// ===============================

app.put("/api/felicitaciones/:id", (req, res) => {

    const id = req.params.id;

    const {
        carta,
        fotos
    } = req.body;

    const listaFotos = fotos || [];

    const foto1 = listaFotos[0] || "";
    const foto2 = listaFotos[1] || "";
    const foto3 = listaFotos[2] || "";
    const foto4 = listaFotos[3] || "";
    const foto5 = listaFotos[4] || "";

    const sql = `
        UPDATE felicitaciones
        SET
            carta = ?,
            foto1 = ?,
            foto2 = ?,
            foto3 = ?,
            foto4 = ?,
            foto5 = ?
        WHERE id = ?
    `;

    db.run(
        sql, [
            carta || "",
            foto1,
            foto2,
            foto3,
            foto4,
            foto5,
            id
        ],
        function(error) {

            if (error) {
                console.error(error);

                return res.status(500).json({
                    correcto: false,
                    mensaje: "No se pudo actualizar."
                });
            }

            if (this.changes === 0) {
                return res.status(404).json({
                    correcto: false,
                    mensaje: "No se encontró la felicitación."
                });
            }

            res.json({
                correcto: true,
                mensaje: "Felicitación actualizada correctamente."
            });
        }
    );
});

// ===============================
// INICIAR SERVIDOR
// ===============================

app.listen(PORT, () => {

    console.log("----------------------------------");
    console.log("Servidor iniciado correctamente");
    console.log(`http://localhost:${PORT}/crear.html`);
    console.log("----------------------------------");

});