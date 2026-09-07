#!/usr/bin/env python3
from pathlib import Path


def rep(text, old, new, label, count=1):
    found = text.count(old)
    if found < count:
        raise SystemExit(f"{label}: expected at least {count}, found {found}")
    return text.replace(old, new, count)

p = Path('app/src/main/assets/www/index.html')
s = p.read_text(encoding='utf-8')

s = rep(s, '<title>Дзен Текст 1.8.0</title>', '<title>Дзен Текст 1.8.1</title>', 'html title')

old_note = '<div class="smallNote">Локальный редакторский фильтр: длинное тире, шаблонные вводные и переходы, конструкции «не просто X, а Y» / «не только X, но и Y», чрезмерные связки, однообразные H2 и серия абзацев с мини-слоганами. Это не доказательство авторства ИИ, а поиск характерного машинного почерка.</div>'
new_note = '<div class="smallNote">Локальный фильтр проверяет только типографические символы, характерные для машинного текста. Сейчас отмечается длинное тире «—». Словосочетания, клише и смысловые шаблоны здесь не анализируются.</div>'
s = rep(s, old_note, new_note, 'settings AI note')

start = s.find('function aiNorm(s){')
end = s.find('function analyzeProofLocal(src,issues){', start)
if start < 0 or end < 0:
    raise SystemExit('AI-style function block not found')
new_block = r'''function addAIStyleAggregate(issues,title,detail,occurrences){if(!occurrences||!occurrences.length)return;const first=occurrences[0];addSimpleIssue(issues,'aiStyle',title,detail,first.start,first.end,'warning');const it=issues[issues.length-1];if(occurrences.length>1){it.occurrences=occurrences.slice(0,80);it.navTitle=title}}
function analyzeAIStyle(src,headings,paragraphs,issues){
 const dashOcc=Array.from(src.matchAll(/—/g)).map(m=>({start:m.index,end:m.index+1}));
 if(dashOcc.length)addAIStyleAggregate(issues,`Длинное тире — ${dashOcc.length} раз`,'Найден символ «—». В нашем редакционном фильтре он считается типографическим маркером машинного текста. Нажмите, чтобы просмотреть все места. Сам по себе символ не доказывает авторство ИИ.',dashOcc);
}
'''
s = s[:start] + new_block + s[end:]

s = s.replace('Dzen-Text/1.8.0 Android', 'Dzen-Text/1.8.1 Android')
p.write_text(s, encoding='utf-8')

b = Path('app/build.gradle')
t = b.read_text(encoding='utf-8')
t = rep(t, 'versionCode 27', 'versionCode 28', 'versionCode')
t = rep(t, "versionName '1.8.0'", "versionName '1.8.1'", 'versionName')
b.write_text(t, encoding='utf-8')

r = Path('README.md')
readme = r.read_text(encoding='utf-8')
readme = rep(readme, 'Текущая версия: **v1.8.0**.', 'Текущая версия: **v1.8.1**.', 'README version')
start = readme.find('### Признаки ИИ-стиля')
end = readme.find('\n### ', start + 5)
if start < 0 or end < 0:
    raise SystemExit('README AI-style section not found')
section = '''### Признаки ИИ-стиля\n\nЭтот слой намеренно сделан узким: он проверяет **только типографические символы**, а не словосочетания и не пытается угадывать автора по смыслу текста.\n\nСейчас проверяется:\n\n- длинное тире `—`.\n\nЕсли длинных тире несколько, замечание показывает их количество и позволяет листать все найденные места. Это редакторский маркер, а не доказательство того, что текст написал ИИ.\n\n'''
readme = readme[:start] + section + readme[end+1:]
r.write_text(readme, encoding='utf-8')

print('Patched Dzen Text to v1.8.1: AI-style check is symbols-only')
