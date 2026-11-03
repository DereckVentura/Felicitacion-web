# Continuar RAMO

Carpeta: C:\Users\Ventura\Documents\Codex\2026-10-30\cone
Sitio actual: https://ramo-recuerdos-floristerias.lovosdavid.chatgpt.site/
Dirección anterior: https://ramo-recuerdos-floristerias.civilchub131.chatgpt.site/ (redirecciona conservando la ruta).
Sites project_id: appgprj_6ae46f850a8081918262becaf7060e21
Última versión publicada antes de esta fase: 9, commit 6c7f0265bd57f5400826f08404b6d292abaef16e. La revisión de Fase 1 se prepara a continuación; consultar Sites para el estado y commit vigentes.

## Alcance autorizado
El usuario pidió Fase 1 del documento skills_escalabilidad_ramo_autorent.md. No cambiar precios; el administrador debe poder editar paquetes. Aplicado: WebP 1200px/0.8 en todos los inputs de imagen, validación raster y limpieza de metadatos, PIN opcional con bloqueo persistente 5 intentos/60 segundos y protección de fotos, URL base QR configurable, modal interactivo de muestra. No implementar fases 2/3 sin nueva instrucción.

## Funciones que deben preservarse
RAMO vende créditos de tarjetas QR a floristerías y tiendas de regalos. Administrador de la app: dereckenriquev@gmail.com. Panel de tiendas, paquetes editables, solicitudes de créditos, perfil y logo, impresión múltiple plegada por defecto. QR público /r/:id, editor privado /personalizar/:token, impresión protegida /imprimir/:id y muestra pública /muestra. Logo original/solo contorno/ninguno y color personalizado compacto al crear y diseñar; felicitación hereda el color de tarjeta con opción independiente. Eliminar tarjeta requiere confirmar con un botón; eliminar tienda pide su nombre. Pagos electrónicos siguen pendientes.

## Validación
388 aserciones del manejador real con SQLite/R2 aislados, incluido PIN concurrente, revocación de sesiones, imágenes protegidas, paquetes y actualización desde datos previos. test-images.mjs comprueba metadatos y conversión con adaptador canvas. check-print.mjs comprueba SVG, color, márgenes y A4. No hay herramienta de navegador interactiva disponible en esta sesión; no declarar completada esa revisión visual.

## Continuación y publicación
Leer README.md y reutilizar este Site, sus recursos D1/R2 y su URL; no crear un reemplazo. No editar las migraciones ya aplicadas 0000–0003; la Fase 1 añade 0004_good_masque.sql. No copiar credenciales. Los datos productivos no se incluyen en esta carpeta. Otra cuenta necesita permisos de publicación sobre el Site original además del código local. El acceso de aplicación y la propiedad de alojamiento son distintos.

## Actualización Fase 2
El usuario autorizó fase 2 y opciones de tipografía/alineación. Implementados experiencia de sobre, música/voz, formato de carta, agradecimiento y lotes de seis con activación y sellado. Leer README para operaciones. Migración nueva 0005. Usuario NO tiene dominio: no cambiar slug ni crear Site sustituto; queda pendiente conectar un dominio propio. No cambia precios ni rol del administrador. Última versión previa: 10, commit 35952d0ecf0e03879e57ec416f5fc7b1a60e3e8e. Consultar Sites para publicación vigente.

## Actualización Fase 3
Autorizada Fase 3. Catálogo público con precios actuales, calculadora, documentos legales, aceptación verificable y solicitudes de eliminación. Nueva migración 0006. El usuario respondió «Sí» al correo de soporte; no dio nombre legal/domicilio/NIT: se dejan editables en Paquetes → Privacidad y datos comerciales, sin inventarlos. Tratamiento tributario pendiente. Dominio propio pendiente: no tiene uno. Última versión previa a esta revisión: 11, commit 406a48f3e9fb7db1ae5518156a18b823d5c6c4bd. Leer README y consultar Sites para versión vigente.

## Revisión de carga y GitHub (3 noviembre 2026)
El usuario confirmó que el editor queda en «Abriendo un espacio para tu historia…» y el destino GitHub DereckVentura/Felicitacion-web. Corregido BuyerEditor: cargar texto sin esperar fotos/voz, avisos de descarga, límites de tiempo también para cuerpos JSON/blob y cancelación al abandonar la página. No se rotan accesos ni alteran contenidos con esta corrección. Tests específicos en scripts/test-editor-network.mjs (12 comprobaciones); 479 aserciones API y otras comprobaciones conservadas. No hay verificación visual interactiva disponible.
Se añadió la cuenta DereckVentura con Git Credential Manager; no se desconectó davidlovoss del conector. La copia GitHub está en C:\Users\Ventura\Documents\Codex\2026-10-30\ramo-github y conserva main original. Consultar resultados de publicación y GitHub en el chat antes de asumir que la revisión está publicada. La Fase 3 anterior estaba únicamente local por fallos del servidor Git de Sites; esta publicación debe incluirla sin recrear el Site ni cambiar D1/R2.

## Revisión fotos/música/carta final
Usuario reportó fotos no disponibles en ambos visores; caso Kathy. Se verificaron las cuatro imágenes mediante descarga y decodificación JPEG; tardan 20–37 s. Ajustado límite de foto a 45 s, estados de carga/reintentos y Content-Length real de R2. Biblioteca de seis melodías con búsqueda/previa; importación de audio/video con selección de fragmento y AudioWorklet local; micrófono retirado. Carta final sin reacciones ni LegalLinks/RemovalRequest; acciones PDF y reproductor integrados a sus colores. PDF local A4 compartible sin dependencias nuevas (raster-pdf.ts). No hubo cambios de datos ni migraciones. Pruebas de API 497; audio/PDF 21; red 12; check-gift-ui renderiza React real. Revisar publicación en el chat; no asumir publicada antes del éxito de Sites. No hay conexión nativa para navegador Computer Use.
