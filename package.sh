#!/bin/bash
# Crea i pacchetti .zip per Chrome e Firefox.
set -e
cd "$(dirname "$0")"
FILES="background.js gallery.html gallery.css gallery.js popup.html popup.css popup.js icon-16.png icon-32.png icon-48.png icon-128.png vendor LICENSE README.md"

# Chrome (usa manifest.json com'e)
rm -f grok-imagine-exporter-chrome.zip
zip -rq grok-imagine-exporter-chrome.zip $FILES manifest.json
echo "creato grok-imagine-exporter-chrome.zip"

# Firefox (manifest.firefox.json -> manifest.json)
TMP=$(mktemp -d)
cp -r $FILES "$TMP"/
cp manifest.firefox.json "$TMP"/manifest.json
( cd "$TMP" && zip -rq out.zip . -x "*.DS_Store" )
mv "$TMP"/out.zip grok-imagine-exporter-firefox.zip
rm -rf "$TMP"
echo "creato grok-imagine-exporter-firefox.zip"
