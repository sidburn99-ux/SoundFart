# Regenere la section « const TSV » de suivi.html depuis suivi.tsv.
# IMPORTANT : tout en UTF-8 explicite — Windows PowerShell 5.1 lit les
# fichiers sans BOM en ANSI et corromprait les accents a chaque passage.
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$tsvPath = "$PSScriptRoot\suivi.tsv"
$htmlPath = "$PSScriptRoot\suivi.html"
$tsv = [System.IO.File]::ReadAllText($tsvPath, [System.Text.Encoding]::UTF8)
$html = [System.IO.File]::ReadAllText($htmlPath, [System.Text.Encoding]::UTF8)
# Le TSV est injecte dans un template literal JS : echapper \, ` et ${
# (remplacements litteraux — '-replace' interprerait $ comme reference de
# groupe .NET). '"' -> '\"' est conserve (inoffensif dans un template literal).
$inj = $tsv.Replace('\', '\\').Replace('"', '\"').Replace('`', '\`').Replace('${', '\${')
$inj = $inj.Replace("`r`n", '\n').Replace("`n", '\n')
# Ancre sur la fin de la ligne d'injection : un « `; » present dans le TSV
# (echappe en '\`') faisait matcher la regex non-greedy trop tot et
# corrompait le HTML au run suivant.
$m = [regex]::Match($html, '(?s)const TSV = `.*?`;\s*\r?\n')
if (-not $m.Success) { Write-Error "const TSV introuvable dans suivi.html"; exit 1 }
$html = $html.Remove($m.Index, $m.Length).Insert($m.Index, 'const TSV = `' + $inj + '`;')
[System.IO.File]::WriteAllText($htmlPath, $html, $utf8)
Write-Output "suivi.html regenere"
