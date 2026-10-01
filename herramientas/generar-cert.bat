@echo off
REM Genera certificado autofirmado para HTTPS local.
REM Uso: generar-cert.bat [IP-del-servidor]
REM Requiere openssl (winget install ShiningLight.OpenSSL.Light).
set IP=%1
if "%IP%"=="" set IP=172.17.0.100
where openssl >nul 2>nul
if errorlevel 1 (
  echo Falta openssl. Instalalo con:
  echo   winget install ShiningLight.OpenSSL.Light
  exit /b 1
)
openssl req -x509 -newkey rsa:2048 -nodes ^
  -keyout ..\servidor\cert-key.pem -out ..\servidor\cert-cert.pem ^
  -days 1825 -subj "/CN=pantallas" ^
  -addext "subjectAltName=IP:%IP%,DNS:pantallas,DNS:localhost,IP:127.0.0.1"
if errorlevel 1 exit /b 1
echo.
echo Certificado creado en servidor\cert-cert.pem para la IP %IP%.
echo 1. Reinicia el servidor (Ctrl+C, npm start): veras la linea "Pantallas HTTPS".
echo 2. Abre el puerto: netsh advfirewall firewall add rule name="Pantallas 8443" dir=in action=allow protocol=TCP localport=8443
echo 3. En CADA pc emisor, copia cert-cert.pem y ejecutalo como admin:
echo      certutil -addstore root cert-cert.pem
echo 4. En ese pc abre https://%IP%:8443/emisora.html y comparte pantalla.
