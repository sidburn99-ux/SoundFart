$tsv = Get-Content "$PSScriptRoot\suivi.tsv" -Raw
$html = Get-Content "$PSScriptRoot\suivi.html" -Raw
$inj = $tsv -replace '\\', '\\' -replace '"', '\"' -replace "`r?`n", '\n'
$html = [regex]::Replace($html, '(?s)const TSV = `.*?`;', 'const TSV = `' + $inj + '`;')
Set-Content "$PSScriptRoot\suivi.html" $html -NoNewline
Write-Output "suivi.html regenere"
