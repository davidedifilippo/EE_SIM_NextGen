#!/bin/sh
# Compila gli sketch d'esempio per Arduino Uno e copia ogni .hex accanto al suo sketch.
# Serve arduino-cli con il core arduino:avr (arduino-cli core install arduino:avr).
set -e
cd "$(dirname "$0")/../src/samples/arduino"
for sketch in */; do
  name="${sketch%/}"
  out="$(mktemp -d)"
  arduino-cli compile --fqbn arduino:avr:uno --output-dir "$out" "$name" >/dev/null
  cp "$out/$name.ino.hex" "$name/$name.hex"
  rm -rf "$out"
  echo "$name: $(wc -c < "$name/$name.hex") byte"
done
