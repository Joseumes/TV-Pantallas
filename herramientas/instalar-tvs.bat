@echo off
REM Instala la APK en las 4 TVs y la lanza. Uso: instalar-tvs.bat [apk]
set APK=%1
if "%APK%"=="" set APK=app-release.apk
for %%I in (101 102 103 104) do (
  echo === TV 192.168.10.%%I ===
  adb connect 192.168.10.%%I:5555
  adb install -r %APK%
  adb shell am start -n com.universidad.pantallas/.MainActivity
)
adb devices
