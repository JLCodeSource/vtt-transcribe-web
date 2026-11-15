#!/usr/bin/env bash
# Regenerates the speech fixtures with Piper, an open-source neural TTS. No API key, no cloud:
#   e2e/fixtures/two-voices.wav + .rttm   two-person conversation (voices ryan / amy) with exact speaker turns
#   e2e/fixtures/speech-fr.mp3, speech-es.mp3   short French / Spanish clips for language detection
# Needs docker; downloads the voices (~250 MB, cached in .cache/piper) from Hugging Face on first run.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=e2e/fixtures
CACHE="$PWD/.cache/piper"; mkdir -p "$CACHE"
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
U="$(id -u):$(id -g)"
PY="docker run --rm -u $U -e HOME=/tmp -e PYTHONPATH=/c/lib -v $CACHE:/c -v $WORK:/w -w /w python:3.12-slim"
PY_I="${PY/docker run/docker run -i}"
FF="docker run --rm -u $U -v $WORK:/w -w /w --entrypoint ffmpeg jrottenberg/ffmpeg:6.1-ubuntu2204"
FP="docker run --rm -u $U -v $WORK:/w -w /w --entrypoint ffprobe jrottenberg/ffmpeg:6.1-ubuntu2204"

[[ -d $CACHE/lib/piper ]] || docker run --rm -u "$U" -e HOME=/tmp -v "$CACHE:/c" python:3.12-slim pip install -q --target /c/lib piper-tts
[[ -f $CACHE/voices/en_US-ryan-medium.onnx ]] || $PY python -m piper.download_voices --download-dir /c/voices \
  en_US-ryan-medium en_US-amy-medium fr_FR-siwis-medium es_ES-davefx-medium

say() { # voice text outfile
  printf '%s' "$2" | $PY_I python -m piper -m "/c/voices/$1.onnx" -f "/w/$3" >/dev/null
}

# --- language clips
say fr_FR-siwis-medium "Bonjour à tous. Aujourd'hui, nous allons parler de la façon dont les ordinateurs apprennent à comprendre la voix humaine. C'est un sujet passionnant." fr.wav
say es_ES-davefx-medium "Buenos días a todos. Hoy vamos a hablar de cómo las computadoras aprenden a entender la voz humana. Es un tema muy interesante." es.wav
$FF -y -loglevel error -i fr.wav -ac 1 -ar 22050 -b:a 64k speech-fr.mp3
$FF -y -loglevel error -i es.wav -ac 1 -ar 22050 -b:a 64k speech-es.mp3
cp "$WORK/speech-fr.mp3" "$WORK/speech-es.mp3" "$OUT/"

# --- two-voice conversation. speaker|text
TURNS=(
  "A|Hi, thanks for joining the call. Did you get a chance to read the project proposal I sent over yesterday?"
  "B|Yes, I went through it last night. Overall it looks solid, but I have a couple of concerns about the timeline."
  "A|Fair enough. Which part worries you the most, the design phase or the testing phase?"
  "B|Mostly the testing phase. Two weeks seems very tight if we want to cover every browser properly."
  "A|That is a good point. We could add a third week and drop the optional reporting feature."
  "B|I like that plan. Let us write it down and share it with the whole team this afternoon."
)
: > "$WORK/list.txt"; : > "$OUT/two-voices.rttm"; t=0
for i in "${!TURNS[@]}"; do
  spk=${TURNS[$i]%%|*}; text=${TURNS[$i]#*|}
  voice=en_US-ryan-medium; [[ $spk == B ]] && voice=en_US-amy-medium
  say "$voice" "$text" "turn-$i.wav"
  $FF -y -loglevel error -i "turn-$i.wav" -ac 1 -ar 16000 -af "apad=pad_dur=0.4" "n-$i.wav"
  dur=$($FP -v error -show_entries format=duration -of csv=p=0 "n-$i.wav")
  speech=$(awk -v d="$dur" 'BEGIN{printf "%.3f", d-0.4}')
  printf 'SPEAKER two-voices 1 %.3f %s <NA> <NA> %s <NA> <NA>\n' "$t" "$speech" "$spk" >> "$OUT/two-voices.rttm"
  t=$(awk -v t="$t" -v d="$dur" 'BEGIN{printf "%.3f", t+d}')
  echo "file 'n-$i.wav'" >> "$WORK/list.txt"
done
$FF -y -loglevel error -f concat -safe 0 -i list.txt -c copy two-voices.wav
cp "$WORK/two-voices.wav" "$OUT/two-voices.wav"
ls -l "$OUT"/two-voices.* "$OUT"/speech-*.mp3 | awk '{print $5, $9}'; cat "$OUT/two-voices.rttm"
