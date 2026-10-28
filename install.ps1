# Instalador de um comando do hadouken, Windows (spec v0.5.2).
#   irm https://raw.githubusercontent.com/Garioli-Labs/claude-hadouken/main/install.ps1 | iex
#   $env:HADOUKEN_INSTALAR = '--sim --sem-extras'; irm ... | iex
#   powershell -ExecutionPolicy Bypass -File install.ps1 --sim
# Passos 1 a 5: confere git, Node e claude; pergunta uma vez e instala o que
# falta (winget e o instalador oficial do Claude Code); instala o plugin
# principal; chama o instalar-tudo.js do plugin. Windows PowerShell 5.1.
# Tudo dentro do bloco: no irm | iex o script roda na sessao de quem chamou,
# e as funcoes nao ficam nela; o codigo vai para $LASTEXITCODE e so ha exit
# quando o script roda como arquivo. So ASCII (o 5.1 le .ps1 sem BOM como ANSI).

& {
  $ID = 'hadouken@claude-hadouken'
  $NodeMin = [version]'20.0.0'
  $ClaudeMin = [version]'2.1.251'
  $Opcoes = @{
    '--sim' = '--sim'; '-sim' = '--sim'
    '--sem-extras' = '--sem-extras'; '-semextras' = '--sem-extras'
    '--com-aprendizado' = '--com-aprendizado'; '-comaprendizado' = '--com-aprendizado'
    '--sem-aprender' = '--sem-aprender'; '-semaprender' = '--sem-aprender'
    '--substituir-barra' = '--substituir-barra'; '-substituirbarra' = '--substituir-barra'
  }

  function Hadouken-Parar([string]$texto) {
    Write-Host "hadouken: $texto" -ForegroundColor Red
    throw 'HADOUKEN_PAROU'
  }

  function Hadouken-Pergunta([string]$texto, [bool]$padrao) {
    if ($Repasse -contains '--sim') { return $true }
    if ([Console]::IsInputRedirected) { return $false }
    $r = "$(Read-Host $texto)".Trim().ToLower()
    if ($r -eq '') { return $padrao }
    return @('s', 'sim', 'y', 'yes') -contains $r
  }

  function Hadouken-Exe([string[]]$nomes) {
    $c = Get-Command $nomes -CommandType Application -ErrorAction SilentlyContinue | Where-Object { $_.Source -notlike '*\WindowsApps\*' } | Select-Object -First 1
    if ($c) { return $c.Source }
    return $null
  }

  function Hadouken-Versao([string]$exe) {
    if (-not $exe) { return $null }
    try { $s = "$(& $exe --version 2>$null | Select-Object -First 1)" } catch { return $null }
    if ($s -match '(\d+)\.(\d+)\.(\d+)') { return [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])" }
    return $null
  }

  function Hadouken-AtualizarPath {
    $partes = @([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User'), $env:Path, "$env:USERPROFILE\.local\bin")
    $env:Path = ($partes | Where-Object { $_ }) -join ';'
  }

  function Hadouken-Utf8([scriptblock]$bloco) {
    $antes = $null
    try { $antes = [Console]::OutputEncoding; [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
    try { & $bloco } finally { if ($antes) { try { [Console]::OutputEncoding = $antes } catch { } } }
  }

  # installPath do plugin principal (escopo user) em `claude plugin list --json`.
  function Hadouken-PastaPlugin {
    $texto = Hadouken-Utf8 { (& $Claude plugin list --json 2>$null) -join "`n" }
    try { $lista = ConvertFrom-Json -InputObject $texto } catch { return $null }
    foreach ($p in $lista) {
      if ($p.id -eq $ID -and ($null -eq $p.scope -or $p.scope -eq 'user') -and $p.installPath -is [string]) { return $p.installPath }
    }
    return $null
  }

  function Hadouken-Winget([string]$id) {
    & $winget install --id $id -e --accept-source-agreements --accept-package-agreements --disable-interactivity | Out-Host
    return ($LASTEXITCODE -eq 0)
  }

  # Devolve o codigo de saida. Toda saida de comando nativo vai para o host
  # (| Out-Host): o que caisse no pipeline viraria parte do valor devolvido.
  # $Repasse vem do bloco; as funcoes chamadas daqui leem $Repasse e $Claude
  # desta funcao (escopo dinamico), e nada fica na sessao de quem chamou.
  function Hadouken-Principal {
    $env:Path = "$env:Path;$env:USERPROFILE\.local\bin"
    $winget = Hadouken-Exe @('winget.exe')
    # winget fica em WindowsApps: procurar de novo sem o filtro.
    if (-not $winget) { $w = Get-Command winget.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1; if ($w) { $winget = $w.Source } }

    # 1. Confere o PC.
    $faltaGit = -not (Hadouken-Exe @('git.exe', 'git.cmd'))
    $vNode = Hadouken-Versao (Hadouken-Exe @('node.exe'))
    $faltaNode = ($null -eq $vNode) -or ($vNode -lt $NodeMin)
    $vClaude = Hadouken-Versao (Hadouken-Exe @('claude.exe', 'claude.cmd'))
    $claudeAcao = if ($null -eq $vClaude) { 'instalar' } elseif ($vClaude -lt $ClaudeMin) { 'atualizar' } else { 'ok' }

    # 2 e 3. Pergunta uma vez e instala o que falta.
    if ($faltaGit -or $faltaNode -or $claudeAcao -ne 'ok') {
      Write-Host 'Falta para o hadouken:'
      if ($faltaGit) { Write-Host '  - git (Git for Windows, que traz o Git Bash)' }
      if ($faltaNode) { Write-Host '  - Node 20 ou mais novo' }
      if ($claudeAcao -eq 'instalar') { Write-Host '  - Claude Code' }
      if ($claudeAcao -eq 'atualizar') { Write-Host "  - Claude Code $ClaudeMin ou mais novo (claude update)" }
      if (($faltaGit -or $faltaNode) -and -not $winget) {
        Hadouken-Parar 'sem winget: instale o Git (https://git-scm.com/) e o Node 20+ (https://nodejs.org/) e rode o comando de novo'
      }
      if (-not (Hadouken-Pergunta 'Instalar agora? [s/N]' $false)) {
        Hadouken-Parar 'nada instalado. Node: https://nodejs.org/ ; Claude Code: irm https://claude.ai/install.ps1 | iex'
      }
      if ($faltaGit -and -not (Hadouken-Winget 'Git.Git')) { Hadouken-Parar 'winget install Git.Git falhou; rode-o e depois o comando de novo' }
      if ($faltaNode -and -not (Hadouken-Winget 'OpenJS.NodeJS.LTS')) { Hadouken-Parar 'winget install OpenJS.NodeJS.LTS falhou; rode-o e depois o comando de novo' }
      if ($claudeAcao -eq 'instalar') {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command 'irm https://claude.ai/install.ps1 | iex' | Out-Host
        if ($LASTEXITCODE -ne 0) { Hadouken-Parar 'o instalador do Claude Code falhou; rode irm https://claude.ai/install.ps1 | iex' }
      } elseif ($claudeAcao -eq 'atualizar') {
        & (Hadouken-Exe @('claude.exe', 'claude.cmd')) update | Out-Host
        if ($LASTEXITCODE -ne 0) { Hadouken-Parar 'claude update falhou; rode-o e depois o comando de novo' }
      }
      if ($faltaGit -or $faltaNode -or $claudeAcao -eq 'instalar') { Hadouken-AtualizarPath }
      $vNode = Hadouken-Versao (Hadouken-Exe @('node.exe'))
      if (($null -eq $vNode) -or ($vNode -lt $NodeMin)) { Hadouken-Parar 'o Node 20+ nao ficou disponivel; abra um PowerShell novo e rode o comando de novo' }
      $vClaude = Hadouken-Versao (Hadouken-Exe @('claude.exe', 'claude.cmd'))
      if (($null -eq $vClaude) -or ($vClaude -lt $ClaudeMin)) { Hadouken-Parar "o Claude Code $ClaudeMin+ nao ficou disponivel; abra um PowerShell novo e rode o comando de novo" }
    }

    # Extras de pacote (Python e gh); o pip e o setup.sh ficam no instalar-tudo.
    if ($Repasse -notcontains '--sem-extras') {
      Write-Host 'Extras: Python 3 (~100 MiB), graphify (pip), Playwright com Chromium, axe-core e lighthouse da yu-ux (~150 MiB) e o gh.'
      if (Hadouken-Pergunta 'Instalar tambem os extras? [S/n]' $true) {
        $mudou = $false
        if (-not (Hadouken-Exe @('python.exe', 'py.exe'))) {
          if ($winget) { if (Hadouken-Winget 'Python.Python.3.12') { $mudou = $true } else { Write-Host 'hadouken: winget install Python.Python.3.12 falhou; os outros extras seguem' } }
        }
        if (-not (Hadouken-Exe @('gh.exe'))) {
          if ($winget) { if (Hadouken-Winget 'GitHub.cli') { $mudou = $true } else { Write-Host 'hadouken: winget install GitHub.cli falhou; os outros extras seguem' } }
        }
        if ($mudou) { Hadouken-AtualizarPath }
      } else {
        $Repasse = @($Repasse) + '--sem-extras'
      }
    }

    # 4. O plugin principal.
    $Claude = Hadouken-Exe @('claude.exe', 'claude.cmd')
    & $Claude plugin marketplace add Garioli-Labs/claude-hadouken *> $null
    & $Claude plugin marketplace update claude-hadouken *> $null
    if (Hadouken-PastaPlugin) { & $Claude plugin update $ID | Out-Host } else { & $Claude plugin install $ID | Out-Host }

    # 5. A pasta do plugin e o resto em Node.
    $raiz = Hadouken-PastaPlugin
    $tudo = if ($raiz) { Join-Path $raiz 'src\instalar-tudo.js' } else { $null }
    if (-not $tudo -or -not (Test-Path -LiteralPath $tudo)) { Hadouken-Parar "o plugin nao instalou; rode claude plugin install $ID" }
    $env:HADOUKEN_CLAUDE = $Claude
    $py = Hadouken-Exe @('python.exe', 'py.exe')
    if ($py) { $env:HADOUKEN_PYTHON = $py }
    try {
      $node = Hadouken-Exe @('node.exe')
      Hadouken-Utf8 { & $node $tudo @Repasse | Out-Host }
      $codigo = $LASTEXITCODE
    } finally {
      Remove-Item Env:HADOUKEN_CLAUDE, Env:HADOUKEN_PYTHON -ErrorAction SilentlyContinue
    }
    $gh = Hadouken-Exe @('gh.exe')
    if ($gh) { & $gh auth status *> $null; if ($LASTEXITCODE -ne 0) { Write-Host 'Proximo passo, para a secao do GitHub no relatorio: gh auth login' } }
    Write-Host 'Os limites de 5 h e 7 dias aparecem nos planos Pro e Max.'
    return $codigo
  }

  # Opcoes: argumentos (-File) e HADOUKEN_INSTALAR (irm | iex).
  $Repasse = @()
  $codigo = 0
  foreach ($a in @($args) + @("$env:HADOUKEN_INSTALAR" -split '\s+' | Where-Object { $_ })) {
    $k = "$a".ToLower()
    if (-not $Opcoes.ContainsKey($k)) {
      Write-Host 'hadouken: opcao desconhecida; as opcoes sao --sim, --sem-extras, --sem-aprender e --substituir-barra' -ForegroundColor Red
      $codigo = 2
      break
    }
    if ($Repasse -notcontains $Opcoes[$k]) { $Repasse += $Opcoes[$k] }
  }
  if ($codigo -eq 0) {
    try {
      $codigo = Hadouken-Principal
    } catch {
      if ("$_" -ne 'HADOUKEN_PAROU') { Write-Host "hadouken: erro inesperado: $_" -ForegroundColor Red }
      $codigo = 1
    }
  }
  $global:LASTEXITCODE = $codigo
} @args

if ($MyInvocation.MyCommand.CommandType -eq 'ExternalScript' -and $MyInvocation.MyCommand.Name -eq 'install.ps1') { exit $global:LASTEXITCODE }
