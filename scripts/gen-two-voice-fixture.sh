#!/usr/bin/env bash
# Generates e2e/fixtures/two-voices.wav + .rttm: a short two-person conversation with REAL distinct
# synthetic voices (OpenAI TTS: "onyx" and "nova"), and an exact reference of who speaks when.
# Needs OPENAI_API_KEY in your environment (a few cents of TTS) and docker (for ffmpeg).
# Output contains no key. Re-run only if you want to regenerate the fixture.
#   OPENAI_API_KEY=... ./scripts/gen-two-voice-fixture.sh
# Test hook: TURNS_DIR=/dir with pre-made turn-N.wav files skips the TTS calls.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=e2e/fixtures
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
FF="docker run --rm -u $(id -u):$(id -g) -v $WORK:/w -w /w --entrypoint ffmpeg jrottenberg/ffmpeg:6.1-ubuntu2204"
FP="docker run --rm -u $(id -u):$(id -g) -v $WORK:/w -w /w --entrypoint ffprobe jrottenberg/ffmpeg:6.1-ubuntu2204"

# speaker|text   (alternating voices; A=onyx, B=nova)
TURNS=(
  "A|Hi, thanks for joining the call. Did you get a chance to read the project proposal I sent over yesterday?"
  "B|Yes, I went through it last night. Overall it looks solid, but I have a couple of concerns about the timeline."
  "A|Fair enough. Which part worries you the most, the design phase or the testing phase?"
  "B|Mostly the testing phase. Two weeks seems very tight if we want to cover every browser properly."
  "A|That is a good point. We could add a third week and drop the optional reporting feature."
  "B|I like that plan. Let us write it down and share it with the whole team this afternoon."
)

if [[ -n "${TURNS_DIR:-}" ]]; then
  cp "$TURNS_DIR"/turn-*.wav "$WORK"/
else
  : "${OPENAI_API_KEY:?set OPENAI_API_KEY to generate the voices}"
  for i in "${!TURNS[@]}"; do
    spk=${TURNS[$i]%%|*}; text=${TURNS[$i]#*|}
    voice=onyx; [[ $spk == B ]] && voice=nova
    body=$(printf '{"model":"tts-1","voice":"%s","input":"%s","response_format":"wav"}' "$voice" "$text")
    curl -sS --fail https://api.openai.com/v1/audio/speech \
      -H "Authorization: Bearer $OPENAI_API_KEY" -H 'Content-Type: application/json' \
      -d "$body" -o "$WORK/turn-$i.wav"
  done
fi

# Normalise every turn to 16 kHz mono, add 0.4 s of silence after it, concat, and write the RTTM.
: > "$WORK/list.txt"; : > "$OUT/two-voices.rttm"; t=0
for i in "${!TURNS[@]}"; do
  spk=${TURNS[$i]%%|*}
  $FF -y -loglevel error -i "turn-$i.wav" -ac 1 -ar 16000 -af "apad=pad_dur=0.4" "n-$i.wav"
  dur=$($FP -v error -show_entries format=duration -of csv=p=0 "n-$i.wav")
  speech=$(awk -v d="$dur" 'BEGIN{printf "%.3f", d-0.4}')
  printf 'SPEAKER two-voices 1 %.3f %s <NA> <NA> %s <NA> <NA>\n' "$t" "$speech" "$spk" >> "$OUT/two-voices.rttm"
  t=$(awk -v t="$t" -v d="$dur" 'BEGIN{printf "%.3f", t+d}')
  echo "file 'n-$i.wav'" >> "$WORK/list.txt"
done
$FF -y -loglevel error -f concat -safe 0 -i list.txt -c copy two-voices.wav
cp "$WORK/two-voices.wav" "$OUT/two-voices.wav"
echo "wrote $OUT/two-voices.wav ($(du -h "$OUT/two-voices.wav" | cut -f1)) and .rttm"; cat "$OUT/two-voices.rttm"
