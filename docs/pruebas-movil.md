# Probar el formulario desde un celular (cámara y HTTPS)

La cámara del navegador solo funciona en **contextos seguros**: HTTPS o `localhost`. Si
abres `http://192.168.x.x:5173` desde el celular, el navegador **no ofrecerá la cámara**
y el formulario mostrará solo el ingreso manual del QR. Es una restricción del
navegador y no se debe evitar.

Esta guía sirve para pruebas en la red local con datos ficticios. En producción, el
certificado lo define TI de la clínica.

## Requisitos

- El computador y el celular conectados a la **misma red Wi-Fi**.
- [mkcert](https://github.com/FiloSottile/mkcert): herramienta gratuita que crea una
  autoridad certificadora local. Instálala con `winget install FiloSottile.mkcert` o
  descárgala desde su página oficial.
- No se agregan dependencias al proyecto.

## 1. Averiguar la IP del computador en la red local

```powershell
ipconfig
```

Busca la "Dirección IPv4" del adaptador Wi-Fi, por ejemplo `192.168.1.50`. En los
comandos siguientes, reemplaza `192.168.1.50` por tu IP.

## 2. Crear el certificado (fuera del repositorio)

Crea una carpeta para los certificados y entra en ella:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\sgim-certs"
```

```powershell
Set-Location "$env:USERPROFILE\sgim-certs"
```

Instala la autoridad local en tu computador. Basta hacerlo una vez:

```powershell
mkcert -install
```

Genera el certificado para tu IP y para localhost:

```powershell
mkcert -cert-file sgim-dev.pem -key-file sgim-dev-key.pem 192.168.1.50 localhost 127.0.0.1
```

> **No copies estos archivos al repositorio.** La clave privada de la autoridad
> (`rootCA-key.pem`, en la carpeta que indica `mkcert -CAROOT`) **nunca** se comparte.

## 3. Confiar en el certificado desde el celular

1. Muestra la carpeta de la autoridad local con `mkcert -CAROOT` y copia **solo**
   `rootCA.pem` al celular, por ejemplo por cable o correo propio.
2. Instálalo:
   - **Android:** Ajustes → Seguridad → Cifrado y credenciales → Instalar un certificado →
     Certificado de CA. La ruta varía según el fabricante.
   - **iPhone:** abre el archivo para instalar el perfil. Después ve a Ajustes → General →
     Información → Ajustes de confianza de certificados y activa la confianza total.
3. Cuando termines las pruebas, puedes eliminar ese certificado del celular.

## 4. Levantar el backend permitiendo la IP (sin modificar `.env`)

En una consola, desde `backend\` y con el entorno virtual activo. Estas variables solo
duran mientras la consola esté abierta y tienen prioridad sobre `.env`:

```powershell
$env:DJANGO_ALLOWED_HOSTS = "localhost,127.0.0.1,192.168.1.50"
```

```powershell
$env:DJANGO_CSRF_TRUSTED_ORIGINS = "https://192.168.1.50:5173,https://localhost:5173"
```

```powershell
python manage.py runserver 127.0.0.1:8010
```

Django sigue escuchando solo en `127.0.0.1`. El celular llega a él a través de Vite.

## 5. Levantar el frontend con HTTPS en la red local

En otra consola, desde `frontend\`. Indica a Vite dónde está la API:

```powershell
$env:VITE_API_PROXY_TARGET = "http://127.0.0.1:8010"
```

Indica las rutas del certificado y de su clave:

```powershell
$env:VITE_DEV_HTTPS_CERT = "$env:USERPROFILE\sgim-certs\sgim-dev.pem"
```

```powershell
$env:VITE_DEV_HTTPS_KEY = "$env:USERPROFILE\sgim-certs\sgim-dev-key.pem"
```

Arranca Vite, visible en la red local:

```powershell
npm run dev -- --host 0.0.0.0 --port 5173
```

Si Windows pregunta por el firewall, permite el acceso **solo en redes privadas**.

## 6. Probar desde el celular

1. Abre `https://192.168.1.50:5173` en Chrome (Android) o Safari (iPhone).
2. Inicia sesión con el usuario ficticio `ana.prueba` y entra en **Registrar incidencia**.
3. En **Identificación del equipo**:
   - **Escanear QR:** pulsa **Abrir cámara** y acepta el permiso. Apunta a un QR de
     prueba con contenido ficticio, por ejemplo uno que generes con el texto
     `QR-PRUEBA-001`. El campo se completa solo. Prueba también **Cancelar** y la
     corrección manual.
   - **Permiso denegado:** rechaza el permiso y comprueba que aparece el aviso y el campo
     manual.
   - **No tiene QR / No aplica:** elige un motivo. El formulario debe exigir una
     fotografía antes de registrar.
4. Prueba anchos de 320 a 430 px girando el celular o con varios dispositivos.
   Comprueba que no haya desplazamiento horizontal.
5. Si el QR contiene un enlace, comprueba que **no se abre** y que se muestra como texto.

## 7. Al terminar

Detén ambos servidores con `Ctrl+C` y cierra las consolas: las variables de entorno se
descartan. Si ya no harás más pruebas, elimina `rootCA.pem` del celular.
