# eZNotes 🚀

**eZNotes** ist eine hochperformante, professionelle Chrome-Erweiterung, mit der du im Handumdrehen strukturierte Schritt-für-Schritt-Anleitungen, Systemhandbücher und interaktive On-Screen-Guides erstellen kannst. Das Tool erfasst vollautomatisch Screenshots und technische Metadaten während deiner Interaktion und bietet dir einen hochentwickelten Editor zur Nachbearbeitung.

![eZNotes Logo](assets/logo.png)

---

## ✨ Alle Features & Highlights (v2.5)

### 📸 Automatisches Tracking & Aufzeichnung
- **Smart-Capture**: Automatisches Erfassen von Screenshots bei jedem Mausklick.
- **Metadaten-Extraktion**: Automatisches Auslesen von Seitentitel, Hostname, Feldnamen, Session-Details und präzisen **CSS-Selektoren** für Automatisierungen.
- **Steuerung per Hotkeys**: Blitzschnelle Bedienung im Hintergrund:
  - `Strg + S`: Schnellspeicherung (Quick-Save)
  - `Strg + C`: Aktuellen Screenshot kopieren
  - `Strg + D`: Direkter Download der Session

### 🔄 Auto-Save-Backup-Sicherung (NEU!)
- **Ausfallsicheres Arbeiten**: eZNotes speichert deine Arbeit automatisch im Hintergrund, ohne die Performance zu beeinträchtigen.
- **Rollierender Verlauf**: Hält die letzten **15 automatischen Sicherungen** vor (FIFO-Prinzip).
- **Visueller Backup-Manager**: Über den Button `🔄` in der Sidebar kannst du eine chronologische Liste deiner Sicherungspunkte aufrufen, diese mit einem Klick wiederherstellen, einzeln löschen oder komplett bereinigen.

### 🔒 Erweitertes Freischalt-System (NEU!)
- **Profi-Features schützen**: Anspruchsvolle Features sind standardmäßig zum Schutz vor Missbrauch gesperrt.
- **Umfassender Passcode-Schutz**: Die Freischaltung erfolgt über das Kennwort `eZNotesBeta` direkt im Hauptmenü.
- **Folgende Funktionen sind gesperrt**:
  - 📚 **Die Archiv-Bibliothek**: Verwaltung und Laden alter Sessions.
  - 🚀 **RPA Automatisierung**: Das Abspielen und Testen von Makros.
  - 🗺️ **Live Overlay Export**: Starten des interaktiven Website-Guides.
- **Integrierte Logiksicherung**: Sowohl die Steuerelemente in der Benutzeroberfläche (deaktiviert, ausgegraut, gesperrte Tooltips) als auch die internen Funktionsaufrufe sind kryptografisch abgesichert.

### 🤖 RPA Automatisierung (Robotic Process Automation)
- **Makro-Aufzeichnung**: eZNotes zeichnet die geklickten DOM-Elemente als standardisierte CSS-Selektoren auf.
- **Einzeltest (`▶️ Schritt`)**: Teste den Selektor eines einzelnen Schrittes live auf der Zielwebseite.
- **Makro-Player (`🚀 Play All`)**: Spiele alle aufgezeichneten Schritte nacheinander vollautomatisch ab. eZNotes wechselt eigenständig die Tabs, füllt Formularfelder mit dem hinterlegten Text aus und wartet die definierte Verzögerungszeit ab.

### 🗺️ Live Overlay Guide
- **Interaktive On-Screen-Führung**: Startet einen vollautomatischen Guide direkt auf der echten Zielwebseite.
- **Visuelle Highlights**: Dem Anwender wird mit leuchtenden Positions-Rahmen (Overlays) und verständlichen Tooltips direkt auf der Live-Webseite gezeigt, wo er als Nächstes klicken muss.

### ✏️ Leistungsstarker Editor & Datenschutz-Werkzeuge
- **DSGVO-konforme Anonymisierung**: Sensible personenbezogene Daten (PII) wie Namen, Passwörter oder Bankdaten können im Handumdrehen mit dem **Verpixelungs-Werkzeug (Blur-Tool)** zensiert werden.
- **Fokus-Zuschnitt**: Integriertes Smart-Cropping zum schnellen Zuschneiden von Bildausschnitten.
- **Fokus-Marker**: Zeichne frei positionierbare Rechtecke und Richtungspfeile. Unterstützt Multi-Selection (Verschieben/Skalieren/Löschen mehrerer Marker parallel) sowie unbegrenztes `Undo/Redo` (Strg+Z / Strg+Y).
- **Prozess-Struktur**: Füge flexibel **Kapitel-Trenner** und **Rich-Textblöcke** hinzu, um komplexe Vorgänge übersichtlich zu gliedern.

### 📚 Bibliothek & Dateisystem-Synchronisation
- **Browser-Archiv**: Sicheres Abspeichern deiner Dokumentationen im lokalen Datenbereich des Browsers (`chrome.storage.local`).
- **Verzeichnis-Kopplung (File System Access API)**: Verbinde eZNotes mit einem echten Ordner auf deiner Festplatte. Jede Archivierung schreibt direkt eine formatierte `.json`-Datei. Gelöschte Dateien werden automatisch revisionssicher in den Unterordner `OLD` verschoben.
- **Bulk-Merge (Zusammenführung)**: Wähle mehrere Anleitungen in der Bibliothek aus und verschmelze sie mit einem Klick zu einem einzigen Gesamthandbuch.
- **Änderungshistorie (Changelog)**: Jede Dokumentation pflegt ein automatisches Protokoll über alle Änderungen und Bearbeitungsschritte.

### 💾 Vielfältige Export-Optionen
- **PDF Dokument**: Druckoptimiertes, hochprofessionelles Handbuch mit rechsbündigem Logo-Branding und intelligentem Seitenumbruch zur Platzersparnis.
- **YouTrack (Markdown)**: Generiert formatierten Markdown-Code inklusive aller Screenshots für das direkte Einfügen in Ticketsysteme.
- **Interaktive Vorschau**: Eine ansprechende Slideshow-Präsentation im Browser.
- **Offline HTML-Download**: Lädt die Dokumentation als autarke, voll funktionsfähige `.html`-Datei herunter, die ohne Internetverbindung und eZNotes auf jedem Gerät läuft.

---

## 🚀 Installation (Entwicklermodus)

1. Lade dieses Repository als ZIP-Archiv herunter und entpacke es (oder nutze `git clone`).
2. Öffne Google Chrome und navigiere zu `chrome://extensions/`.
3. Aktiviere den **Entwicklermodus** (Schalter oben rechts).
4. Klicke oben links auf **Entpackte Erweiterung laden** und wähle den Projektordner aus (der Ordner, in dem diese `manifest.json` liegt).
5. eZNotes ist nun betriebsbereit! Klicke auf das Puzzle-Symbol in deiner Toolbar, um eZNotes anzuheften.

---

## 🛠️ Benutzung

1. **Session starten**: Klicke auf das eZNotes-Icon und klicke auf **Start**. 
2. **Prozess durchführen**: Führe die Schritte aus, die du dokumentieren willst. eZNotes erfasst im Hintergrund alle Aktionen.
3. **Editor öffnen**: Klicke auf **Beenden** oder direkt auf **Editor & Export**.
4. **Feinschliff**:
   - Ändere Titel und füge Beschreibungen hinzu.
   - Ziehe Fokusrahmen oder Pfeile auf den Bildern auf.
   - **Verpixle kritische Daten** zum Schutz der Privatsphäre.
5. **Archivieren & Exportieren**: Sichere dein Werk in der Bibliothek oder exportiere es als PDF, YouTrack-Markdown, On-Screen-Guide oder Offline-HTML.

---
Erstellt mit ❤️ für maximale Produktivität.  
*Copyright © 2026 Sascha Arend.*
