# Ramo · Recuerdos que florecen

Plataforma para floristerías y tiendas de regalos. Sitio: https://ramo-recuerdos-floristerias.civilchub131.chatgpt.site . Código adaptado desde la idea y el flujo de https://github.com/DereckVentura/Felicitacion-web . Runtime Sites/Vinext con Cloudflare D1 y R2.

## Accesos

El único administrador de la aplicación es la identidad verificada de ChatGPT con correo dereckenriquev@gmail.com. La propiedad del alojamiento no concede por sí sola administración dentro de Ramo. El correo se valida en el servidor; ningún visitante puede reclamar el rol. La cuenta del alojamiento permanece vinculada a su propietario en Sites.

Las tiendas entran con ChatGPT y necesitan la invitación de su tienda, ligada a su correo y de un solo uso (7 días). Cada tienda ve únicamente sus tarjetas, saldo y solicitudes.

El sitio se configura con audiencia pública para que el destinatario escanee /r/{id} sin iniciar sesión. Publicar el sitio no abre las API de administración: exigen identidad y rol en el servidor. Quien tenga un QR publicado puede ver ese regalo; si el comprador activa un PIN, también deberá introducirlo para acceder a la carta y sus fotos. Los borradores no exponen carta ni fotos. El enlace privado /personalizar/{token} autoriza editar solo ese regalo; no se imprime y renovarlo invalida el anterior.

## Paquetes y solicitudes

Catálogo inicial configurable por el administrador:

| Paquete | Precio USD | Precio por tarjeta |
| --- | ---: | ---: |
| 10 créditos | 10 | 1.00 |
| 25 créditos | 20 | 0.80 |
| 50 créditos | 30 | 0.60 |
| 100 créditos | 50 | 0.50 |
| Ilimitado por tienda, sin vencimiento | Consultar precio | No aplica |

El catálogo predeterminado está en la configuración del servidor; los cambios del administrador se guardan como ajustes persistentes. No se insertan ofertas, compradores ni pedidos de prueba en migraciones.

Las tiendas solicitan paquetes. El administrador confirma el pago fuera de Ramo y aprueba o rechaza cada solicitud. La aplicación no cobra tarjetas ni consulta bancos. Cada solicitud conserva cantidad, precio y condiciones originales aunque después cambie el catálogo. La aprobación concede el paquete una sola vez, incluso bajo peticiones simultáneas.

Una tarjeta nueva consume un crédito finito. Editar, publicar, escanear o imprimir no vuelve a cobrar. El ilimitado activo permite crear tarjetas sin descontar el saldo finito; sus créditos se conservan. El administrador puede activar, revocar o ajustar el plan por tienda. El ilimitado inicial no tiene fecha de vencimiento; también existe soporte para duración configurable. Un precio vacío significa consultar, nunca gratuito.

## Tarjetas impresas

Tarjeta compacta de 65 x 85 mm, tres diseños florales y QR vectorial de 46 x 46 mm con cuatro módulos de margen blanco. Nombre de la tienda y destinatario, texto breve y QR destacado. Exportación SVG, impresión individual o A4 con 1, 2, 4 o 6 copias de LA MISMA tarjeta, con marcas de corte.

Imprimir al 100 % / tamaño real y sin encabezados ni pies de página. El formato A4 utiliza seis tarjetas por defecto. La ruta /muestra y los PDF de ejemplo son demostraciones; para entregar un regalo real hay que activar una tarjeta y publicar su contenido. Los enlaces y QR anteriores conservan su destino.

## Direcciones de RAMO

Todas las actualizaciones se publican en el mismo sitio. La dirección principal abre el panel o la página de entrada; no hay que repartir una URL nueva con cada versión.

| Ruta | Uso |
| --- | --- |
| `/` | Entrada y panel de administración o tienda. |
| `/r/{id}` | Felicitación pública del QR; quien recibe el regalo no necesita cuenta. |
| `/personalizar/{token}` | Enlace privado del comprador para editar carta y fotos. No se imprime. |
| `/imprimir/{id}` | Estudio de impresión, autorizado para su tienda y el administrador. |
| `/unirse/{token}` | Invitación privada para vincular la cuenta de una tienda. |
| `/muestra` | Ejemplo de diseño; no es una felicitación vendida. |

## Perfiles, identidad y administración

Cada tienda puede editar su nombre, subir o quitar una imagen JPEG, PNG o WebP de entrada de hasta 5 MB y elegir cómo se integra en sus tarjetas impresas. El correo de acceso y los permisos no se cambian desde el perfil. El administrador también puede editar el perfil de cada tienda.

El estudio de impresión permite conservar los colores originales de la imagen o integrarla con la paleta de la tarjeta. Además de los tres estilos predefinidos, admite un color de fondo personalizado. Las preferencias se guardan por tarjeta. La imagen se incorpora al SVG descargado y a la impresión, sin depender después de un enlace externo. El QR conserva su tamaño, su margen blanco y su contraste.

Al añadir una tienda, el administrador puede elegir un paquete del catálogo vigente, acceso ilimitado, un saldo personalizado o comenzar sin créditos. La asignación queda registrada y no cobra dinero automáticamente.

El administrador puede eliminar felicitaciones con un botón de confirmación; al eliminar una tienda se confirma escribiendo su nombre. La eliminación retira el acceso activo: una felicitación eliminada deja de abrirse, y eliminar una tienda desactiva todos sus recuerdos, accesos de edición e invitaciones. No se devuelven créditos automáticamente. Se conservan los registros e historial administrativo en la base de datos; no es una purga definitiva del almacenamiento. Las tiendas no pueden ejecutar estas acciones administrativas.

Los paquetes se modifican en **Paquetes → Editar paquete**: nombre, cantidad de créditos, precio, moneda, disponibilidad y duración del ilimitado. Las solicitudes anteriores mantienen las condiciones que tenían cuando fueron creadas.

## Preparación y comprobaciones

Requisitos: Node >=22.13, Git y entorno Sites. Instalar con npm ci. No se debe regenerar ni volver a aplicar una migración que ya haya sido aplicada. Ante cambios del esquema, generar una migración NUEVA con npm run db:generate y revisar el SQL antes de desplegar.

Comandos:

- node scripts/test-api.mjs
- node scripts/check-print.mjs
- node scripts/test-images.mjs
- npx tsc --noEmit
- npm run build
- npm run dev

Las migraciones numéricas contienen el esquema y los disparadores de integridad. No guardar SQL auxiliar en drizzle: el alojamiento lo trataría como otra migración. Los disparadores evitan sobregiros, más de cinco fotos, aprobación duplicada y cambios posteriores de las condiciones de una solicitud.

Para D1 local, construir el proyecto y aplicar cada migración numérica pendiente con:
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_NOMBRE.sql

El estado local de D1/R2 es distinto del publicado. El inicio de sesión simulado de desarrollo solo funciona en loopback y no forma parte de producción. La compilación local se prepara con el helper build-site.mjs de Sites y se empaqueta junto con las migraciones. No modificar la política de seguridad de Windows para compilar.

## Alcance comercial

Los cobros, entrega de invitaciones y comprobación de pagos son manuales. No hay facturación automática, integración con tiendas online ni vídeo. Las fotos están limitadas a cinco por regalo. La entrada admite hasta 5 MB; el navegador la convierte a WebP (calidad 0.80, lado máximo 1200 px), y el servidor acepta hasta 3 MB optimizados. Antes del uso comercial, definir soporte, conservación/eliminación de regalos y copias de seguridad del almacenamiento.

## Fase 1: privacidad y muestra interactiva

Las subidas de imágenes del perfil, creación, diseñador, muestra y carta usan el mismo optimizador antes de mostrarse o enviarse: límite de entrada 5 MB, extensión raster permitida, MIME y firma concordantes, canvas/WebP 0.80 y lado máximo 1200 px. Se conserva la transparencia del logo. Se eliminan EXIF/GPS y otros metadatos tanto de la salida del navegador como en el servidor. El tamaño final depende de cada imagen; no se garantiza menos de 200 KB ni disponibilidad sin límites de carga.

El comprador puede activar, cambiar o quitar un PIN de exactamente cuatro dígitos en su editor privado. El PIN se guarda mediante PBKDF2 SHA-256 con sal aleatoria; nunca se devuelve al cliente. Cinco errores consecutivos bloquean los intentos 60 segundos, con contador persistente por regalo. Al acertar se entrega una sesión aleatoria de una hora (cookie HttpOnly/Secure/SameSite y hash en base de datos); cambiar o quitar el PIN invalida las sesiones anteriores. El PIN protege la API de la carta y los archivos de sus fotos; el enlace privado del editor mantiene acceso. No cambia el QR ni consume créditos. Las vistas de regalo/editor y las respuestas de fotos indican noindex/nofollow; los datos no usan caché pública.

`/muestra` permite añadir fotos y carta de demostración y abrir una vista del destinatario en un modal de pantalla completa, con tema, color, nombre y logo actuales. No exige cuenta ni guarda las fotos de prueba en el servidor. Los controles de impresión 65×85 mm, QR de 46 mm, SVG y A4 se conservan.

`PUBLIC_QR_BASE_URL` está en `lib/public-url.ts`: vacío usa el origen actual. Solo establecer un dominio propio cuando ya sirva las mismas rutas de RAMO; cambiar la constante no configura el DNS ni migra los QR impresos.

Migración nueva: `0004_good_masque.sql` (PIN y sesiones), posterior a 0000–0003. La suite aislada verifica 388 aserciones de API, incluida la preservación de datos anteriores y la protección del PIN/fotos. Las comprobaciones de imágenes prueban limpieza de metadatos y el contrato canvas con un adaptador de prueba; no sustituyen la revisión interactiva en un navegador real.

Precios actuales conservados; paquetes editables en Administración → Paquetes. Sobre animado, audio, activación de lotes y propuesta de nuevos precios/legalidad pertenecen a fases posteriores.

## Fase 2: experiencia y tarjetas para activar

La carta pública y la muestra abren un sobre con animación y partículas durante seis segundos, respetando movimiento reducido. Se mantienen cinco fotos para conservar recuerdos anteriores; ahora muestran marcos Polaroid y pies de foto editables. El editor y la muestra ofrecen tipografías editorial/moderna/manuscrita, alineación, tamaño e interlineado. Las opciones se guardan por tarjeta y solo permiten valores validados.

Tres melodías se generan con Web Audio al pulsar escuchar. La nota de voz se puede grabar o subir (hasta 45 segundos); el navegador la convierte a WAV mono 16 kHz sin metadatos. El servidor valida estructura PCM, duración por tamaño y límite de almacenamiento. El audio es privado antes de publicar y queda protegido por el PIN del regalo. No hay reproducción automática. Guardar recuerdo abre impresión/guardar PDF; agradecer permite WhatsApp al teléfono opcional indicado por el comprador, con reacción seleccionada.

En Mis tarjetas → Tarjetas para mostrador, modo B genera seis QR distintos en una operación atómica: 6 créditos al crear, ninguno adicional al activar o publicar, ilimitado respeta su plan. Se entregan seis códigos de un uso que deben descargarse en ese momento; solo se guardan derivados con sal. Escanear /r/:id pendiente muestra activación con bloqueo 5 errores/60 s. Al acertar se entrega un acceso privado nuevo. Publicar una tarjeta de lote sella su contenido: no se puede renovar el editor ni modificar carta, fotos, opciones, audio o PIN. Las tarjetas tradicionales siguen siendo editables. La muestra crea únicamente simulaciones, con código 1234; no persiste ni consume créditos.

Migración nueva 0005_new_ultimatum.sql; no modificar 0000–0004. Pruebas de API incluyen 432 aserciones, activación concurrente, débito de lote sin registros parciales, sellado y audio protegido. Verificación visual interactiva pendiente por falta de herramienta de navegador. El dominio propio queda pendiente: el usuario confirmó no poseer uno. Precios y planes no cambiaron.

Portabilidad: conservar código, SQL D1, objetos R2, IDs/rutas y adaptar autenticación. Hay que comprobar acceso a exportación de datos productivos de Sites antes de prometer una migración; el código local no contiene esos datos. Un dominio propio permite conservar enlaces de nuevos QR al cambiar alojamiento; los QR chatgpt.site dependen del servicio/redirección original. Compartir edición con otra cuenta requiere miembro elegible del mismo workspace y permiso de editor; una invitación externa de visitante no lo concede.

## Fase 3: catálogo público, estimación y privacidad

Inicio y /muestra muestran los paquetes activos del catálogo real, sin cambiar precios, conceder tarjetas gratuitas o convertir el ilimitado perpetuo a mensual. El administrador mantiene la edición en Paquetes. La calculadora usa compra de paquetes enteros para 30 días y muestra créditos restantes; el margen del extra QR descuenta esos paquetes, no flores, impresión, trabajo, comisiones ni impuestos de la tienda. Las opciones sin precio o moneda distinta de USD no se presentan como estimaciones gratuitas.

Términos y privacidad se abren en diálogos descargables desde inicio, panel, muestra, editor y recuerdo. Soporte aprobado: dereckenriquev@gmail.com. Datos legales se editan en Administración → Paquetes → Privacidad y datos comerciales: responsable, domicilio, NIT, teléfono, soporte y tratamiento tributario. El usuario confirmó el correo pero no proporcionó identidad/domicilio/NIT: no inventarlos ni marcar IVA incluido por defecto. Antes de contratar, completar esos campos y revisar condiciones y trámites aplicables. La conservación mínima de 12 meses es una condición comercial solicitada, no una exigencia legal ni promesa de QR perpetuo.

La aceptación explícita se exige en servidor al crear/activar, y antes de modificar o subir contenido al editor. Se conservan fecha y versión 2026-11-03-v1; la aceptación de una tienda no sustituye a la del comprador. La activación registra la aceptación del comprador. Los recuerdos previos permanecen visibles; al volver a editarlos se solicita aceptación. Migración nueva 0006_strange_wild_child.sql; no alterar las anteriores.

«Solicitar eliminación» exige un regalo publicado y su PIN cuando corresponda, recoge contacto y motivo y genera una referencia única por tarjeta. No borra por sí sola. Solo el administrador ve la cola y confirma haber verificado la identidad/legitimación. La aprobación retira el QR, revoca edición y borra carta, fotos y WAV de R2 activo; conserva mínimos administrativos. Si falla R2, queda processing con claves de objetos disponibles para reintento. Finalizar limpia correo y motivo del solicitante. No se promete purga inmediata de backups del proveedor ni se destruyen registros comerciales obligatorios.

Normativa consultada: Ley de Protección de Datos Personales consolidada por ACE con reforma D.L.659/2026 (https://ace.gob.sv/documentos/decretos/decreto_144_proteccion_datos.pdf), obligaciones de la Defensoría (https://www.defensoria.gob.sv/obligaciones/), Ley de Comercio Electrónico D.L.463 y LPC. No presentar los textos como certificación de cumplimiento o registros comerciales ya realizados.

Verificación: 479 aserciones de API; test-commercial.mjs añade escenarios de cálculo, además de TypeScript, imágenes, impresión y compilación. No hay navegador interactivo disponible para revisión visual. El usuario sigue sin dominio propio: quitar el namespace lovosdavid requiere conectar uno; no renombrar slug ni crear otro Site para simularlo. Los enlaces y recursos actuales se conservan.

## Carga del editor y repositorio GitHub

El editor muestra el texto al recibir /api/editor y carga fotos/voz en segundo plano. Cada descarga tiene un límite de 15 segundos; las solicitudes de edición y su respuesta completa tienen 20 segundos. Un archivo ausente o una conexión atascada muestran un aviso y conservan los datos existentes. No se reintentan escrituras automáticamente. El botón «Volver a intentar» permite recuperar errores al abrir el editor. Los accesos reemplazados y sobres sellados mantienen sus restricciones.

Comprobaciones: `node scripts/test-editor-network.mjs` valida autenticación, respuestas inválidas, errores del servidor, cancelación y peticiones/cuerpos que no terminan. Junto a las 479 aserciones de API, TypeScript, impresión, imágenes y cálculo comercial. La revisión interactiva en navegador sigue pendiente.

Destino confirmado del código: https://github.com/DereckVentura/Felicitacion-web. Se prepara una rama nueva a partir de main para conservar su historial y la versión anterior. El repositorio guarda código y migraciones; no incluye la base D1 productiva, fotos/audio R2, credenciales ni estado local. Subirlo a GitHub no cambia el alojamiento actual ni garantiza por sí solo una copia de seguridad de los recuerdos.
