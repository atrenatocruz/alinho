#!/usr/bin/env bash
# Prints dos ecrãs do relógio no simulador (job `screenshots` de watch.yml).
set -euo pipefail

RUNTIME=$(xcrun simctl list runtimes watchOS -j | jq -r '[.runtimes[] | select(.isAvailable)] | last | .identifier')
echo "Runtime: $RUNTIME"
# A série mais recente que existe, no tamanho mais pequeno e no maior.
TYPES=$(xcrun simctl list devicetypes -j | jq -r '.devicetypes[].name' | grep -E '^Apple Watch Series [0-9]+ \([0-9]+mm\)$' | sort -V)
LATEST=$(echo "$TYPES" | sed -E 's/^Apple Watch Series ([0-9]+).*/\1/' | sort -n | tail -1)
SIZES=$(echo "$TYPES" | grep "Series $LATEST " )
SMALL=$(echo "$SIZES" | head -1)
LARGE=$(echo "$SIZES" | tail -1)
echo "Relógios: $SMALL / $LARGE"

SCREENS="setup setupPoints setupServeUs game golden star tiebreak switch decisive scoreStack scoreServeSide scorePaused scoreMatchPoint menu end stopped history"
mkdir -p prints

for TYPE in "$SMALL" "$LARGE"; do
  SIZE=$(echo "$TYPE" | sed -E 's/.*\(([0-9]+)mm\)/\1/')
  UDID=$(xcrun simctl create "relogio-$SIZE" "$TYPE" "$RUNTIME")
  xcrun simctl boot "$UDID"
  xcrun simctl bootstatus "$UDID" -b > /dev/null
  xcrun simctl status_bar "$UDID" override --time "21:14" || true

  xcodebuild -project ios/App/App.xcodeproj -scheme AlinhoWatch \
    -destination "platform=watchOS Simulator,id=$UDID" -derivedDataPath build \
    CODE_SIGNING_ALLOWED=NO build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)" ; test "${PIPESTATUS[0]}" -eq 0
  xcrun simctl install "$UDID" build/Build/Products/Debug-watchsimulator/AlinhoWatch.app

  for LANG in pt-PT en; do
    for S in $SCREENS; do
      xcrun simctl terminate "$UDID" pt.alinho.app.watchkitapp 2>/dev/null || true
      xcrun simctl launch "$UDID" pt.alinho.app.watchkitapp -screenshot "$S" -AppleLanguages "($LANG)" > /dev/null
      sleep 3
      xcrun simctl io "$UDID" screenshot "prints/${SIZE}mm-${LANG}-${S}.png" > /dev/null 2>&1
    done
  done
  xcrun simctl shutdown "$UDID"
done
ls prints
