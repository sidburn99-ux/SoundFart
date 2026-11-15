$tsv = Get-Content "$PSScriptRoot\suivi.tsv" -Raw
$html = Get-Content "$PSScriptRoot\suivi.html" -Raw
# Le TSV est injecte dans un template literal JS : il faut echapper \, ",
# backtick et ${ — sinon une ligne contenant ` ou ${ casse le script.
$inj = $tsv -replace '\\', '\\' -replace '"', '\"' -replace '`', '\`' -replace '\$\{', '\${' -replace "`r?`n", '\n'
$m = [regex]::Match($html, '(?s)const TSV = `.*?`;')
if (-not $m.Success) { Write-Error "const TSV introuvable dans suivi.html"; exit 1 }
$html = $html.Remove($m.Index, $m.Length).Insert($m.Index, 'const TSV = `' + $inj + '`;')
Set-Content "$PSScriptRoot\suivi.html" $html -NoNewline -Encoding UTF8
Write-Output "suivi.html regenere"
