from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "app/src/main/assets/www/js"
errors = []

spelling = (JS / "07-spelling.js").read_text(encoding="utf-8")
start = spelling.find("function runFullCheck()")
end = spelling.find("window.onNativeSpellResult", start)
if start < 0 or end <= start:
    errors.append("runFullCheck block is missing")
else:
    block = spelling[start:end]
    if "AndroidSpell.check" in block:
        errors.append("manual AI check must not call Yandex Speller")
    if "continueManualAiCheck" not in block:
        errors.append("manual check must continue to contextual AI analysis")

ai = (JS / "10-ai-dzen.js").read_text(encoding="utf-8")
required = ["орфографические", "грамматические", "пунктуационные"]
for marker in required:
    if marker not in ai:
        errors.append("AI quality prompt no longer covers: " + marker)

if errors:
    raise SystemExit("\n".join("LANGUAGE PIPELINE: " + e for e in errors))

print("Language pipeline checks OK: noisy Speller bypassed, contextual AI language check retained")
