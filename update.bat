@echo off
setlocal enabledelayedexpansion
color 0F
echo ===============================================================
echo eZNotes - Automatisches Update (GitHub)
echo ===============================================================
echo.

:: KONFIGURATION
set "REPO_URL=https://github.com/SaschaArend/eZNotes/archive/refs/heads/main.zip"
set "TARGET_DIR=%USERPROFILE%\eZNotes"
set "TEMP_ZIP=%TEMP%\eznotes_update.zip"
set "EXTRACT_DIR=%TEMP%\eznotes_extract"

:: PRÜFEN OB ERSTINSTALLATION
set "FIRST_INSTALL=0"
if not exist "%TARGET_DIR%\manifest.json" (
    set "FIRST_INSTALL=1"
    echo INFO: Erstinstallation erkannt.
)

echo 1. Lade neueste Version von GitHub herunter...
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%REPO_URL%' -OutFile '%TEMP_ZIP%'"

if not exist "%TEMP_ZIP%" (
    echo.
    color 0C
    echo FEHLER: Download fehlgeschlagen! Bitte Internetverbindung pruefen.
    pause
    exit /b
)

echo 2. Entpacke Dateien...
if exist "%EXTRACT_DIR%" rmdir /s /q "%EXTRACT_DIR%"
mkdir "%EXTRACT_DIR%"
powershell -Command "Expand-Archive -LiteralPath '%TEMP_ZIP%' -DestinationPath '%EXTRACT_DIR%' -Force"

:: GitHub packt alles in einen Unterordner, diesen muessen wir finden
set "SOURCE_SUBDIR="
for /d %%i in ("%EXTRACT_DIR%\*") do set "SOURCE_SUBDIR=%%i"

if not defined SOURCE_SUBDIR (
    echo.
    color 0C
    echo FEHLER: Entpacken fehlgeschlagen oder Quellordner nicht gefunden!
    del /q "%TEMP_ZIP%"
    rmdir /s /q "%EXTRACT_DIR%"
    pause
    exit /b
)

:: VERSIONSVERGLEICH AUS MANIFEST (Intelligentes Updateverfahren)
if "%FIRST_INSTALL%"=="0" (
    set "LOCAL_VERSION=0.0"
    if exist "%TARGET_DIR%\manifest.json" (
        for /f "delims=" %%v in ('powershell -Command "(Get-Content '%TARGET_DIR%\manifest.json' | ConvertFrom-Json).version"') do set "LOCAL_VERSION=%%v"
    )

    set "NEW_VERSION=0.0"
    if exist "%SOURCE_SUBDIR%\manifest.json" (
        for /f "delims=" %%v in ('powershell -Command "(Get-Content '%SOURCE_SUBDIR%\manifest.json' | ConvertFrom-Json).version"') do set "NEW_VERSION=%%v"
    )

    echo.
    echo ===============================================================
    echo Lokale Version:  v!LOCAL_VERSION!
    echo GitHub Version:  v!NEW_VERSION!
    echo ===============================================================
    echo.

    if "!LOCAL_VERSION!"=="!NEW_VERSION!" (
        color 0A
        echo Deine Version (v!LOCAL_VERSION!) ist bereits aktuell!
        set /p "CHOICE=Moechtest du sie trotzdem neu installieren? (J/N): "
        if /i "!CHOICE!" neq "J" (
            echo.
            echo Update abgebrochen.
            del /q "%TEMP_ZIP%"
            rmdir /s /q "%EXTRACT_DIR%"
            timeout /t 3 >nul
            exit /b
        )
    ) else (
        echo Ein neues Update ist verfuegbar (v!LOCAL_VERSION! -^> v!NEW_VERSION!)!
    )
)

echo 3. Aktualisiere Programmordner...
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"
xcopy "%SOURCE_SUBDIR%\*" "%TARGET_DIR%\" /s /e /y /q >nul

echo 4. Bereinige temporaere Dateien...
del /q "%TEMP_ZIP%"
rmdir /s /q "%EXTRACT_DIR%"

echo.
echo.
echo ===============================================================
if "%FIRST_INSTALL%"=="1" (
    cls
    color 0B
    echo ===============================================================
    echo INSTALLATION FAST ABGESCHLOSSEN!
    echo ===============================================================
    echo.
    echo 1. Druecken Sie eine Taste, um Google Chrome zu oeffnen...
    pause >nul
    
    echo    Chrome wird geoeffnet...
    start chrome chrome://extensions
    echo.
    echo Bitte fuehren Sie nun die restlichen Schritte in Chrome aus:
    echo.
    echo 2. Falls die Seite 'chrome://extensions' nicht automatisch laedt:
    echo    Geben Sie 'chrome://extensions' manuell in die Adresszeile ein.
    echo.
    echo 3. Aktivieren Sie den Schalter 'Entwicklermodus' ^(oben rechts^).
    echo 4. Klicken Sie oben auf 'Entpackte Erweiterung laden'.
    echo 5. Waehlen Sie diesen Ordner aus:
    echo    %TARGET_DIR%
    echo 6. Klicken Sie auf 'Ordner auswaehlen'.
    echo.
    echo ===============================================================
    echo Druecken Sie eine Taste, wenn Sie fertig sind...
    pause >nul
) else (
    color 0A
    echo UPDATE ERFOLGREICH ABGESCHLOSSEN!
    echo ===============================================================
    echo.
    echo Die Erweiterung wurde auf Version v!NEW_VERSION! aktualisiert.
    echo.
    echo Das Fenster schliesst sich automatisch in 5 Sekunden...
    timeout /t 5 >nul
)
exit /b