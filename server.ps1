# Jednoduchý lokální webový server pro Odškrtník (bez instalace čehokoli).
# Spouští se přes start.cmd. Ukončení: Ctrl+C nebo zavřením okna.
param(
  [int]$Port = 8082,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$prefix = "http://localhost:$Port/"

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.ico'  = 'image/x-icon'
  '.webmanifest' = 'application/manifest+json'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try {
  $listener.Start()
} catch {
  Write-Host "Port $Port je obsazený nebo nedostupný. Je aplikace už spuštěná v jiném okně?" -ForegroundColor Red
  Write-Host "Google přihlášení je nastavené na http://localhost:$Port, proto jiný port nepoužívejte." -ForegroundColor Yellow
  Read-Host "Stiskněte Enter pro ukončení"
  exit 1
}

Write-Host ""
Write-Host "  Odškrtník běží na $prefix" -ForegroundColor Green
Write-Host "  Okno nechte otevřené. Ukončíte ho klávesami Ctrl+C."
Write-Host ""

if (-not $NoBrowser) { Start-Process $prefix }

$rootFull = [System.IO.Path]::GetFullPath($root)

try {
  while ($listener.IsListening) {
    # Čekání po krátkých úsecích, aby šlo server ukončit přes Ctrl+C.
    $task = $listener.GetContextAsync()
    while (-not $task.AsyncWaitHandle.WaitOne(300)) { }
    $ctx = $task.GetAwaiter().GetResult()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
      if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }
      $path = [System.IO.Path]::GetFullPath((Join-Path $rootFull $rel))

      # Neposílat nic mimo složku aplikace ani skripty serveru.
      $inside = $path.StartsWith($rootFull + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
      $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
      if (-not $inside -or -not $mime.ContainsKey($ext) -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
        $res.StatusCode = 404
        $bytes = [Text.Encoding]::UTF8.GetBytes('Nenalezeno')
      } else {
        $res.ContentType = $mime[$ext]
        $res.Headers['Cache-Control'] = 'no-cache'
        $bytes = [System.IO.File]::ReadAllBytes($path)
      }
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
      $res.StatusCode = 500
    } finally {
      $res.OutputStream.Close()
    }
  }
} finally {
  $listener.Stop()
}
