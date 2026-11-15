#!/usr/bin/env bash
# Generates short French and Spanish speech fixtures (OpenAI TTS) used to prove on-device language detection.
# Needs OPENAI_API_KEY in your environment (a few cents). Output contains no key.
#   read -rs -p "OpenAI key: " OPENAI_API_KEY; export OPENAI_API_KEY; ./scripts/gen-language-fixtures.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${OPENAI_API_KEY:?set OPENAI_API_KEY}"
gen() { # name voice text
  body=$(printf '{"model":"tts-1","voice":"%s","input":"%s","response_format":"mp3"}' "$2" "$3")
  curl -sS --fail https://api.openai.com/v1/audio/speech -H "Authorization: Bearer $OPENAI_API_KEY" \
    -H 'Content-Type: application/json' -d "$body" -o "e2e/fixtures/$1.mp3"
  echo "wrote e2e/fixtures/$1.mp3 ($(du -h "e2e/fixtures/$1.mp3" | cut -f1))"
}
gen speech-fr nova "Bonjour à tous. Aujourd'hui, nous allons parler de la façon dont les ordinateurs apprennent à comprendre la voix humaine. C'est un sujet passionnant."
gen speech-es onyx "Buenos días a todos. Hoy vamos a hablar de cómo las computadoras aprenden a entender la voz humana. Es un tema muy interesante."
