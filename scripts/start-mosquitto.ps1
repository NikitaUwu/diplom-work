param(
    [switch]$Detached
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $repoRoot "docker-compose.mqtt.yml"

if (-not (Test-Path -LiteralPath $composeFile)) {
    throw "docker-compose.mqtt.yml not found at $composeFile"
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
$dockerPath = if ($docker) { $docker.Source } else { "C:\Program Files\Docker\Docker\resources\bin\docker.exe" }
if (-not (Test-Path -LiteralPath $dockerPath)) {
    throw "Docker is not installed or is not available in PATH. Install Docker Desktop or start Mosquitto manually."
}

$dockerBin = Split-Path -Parent $dockerPath
if ($env:PATH -notlike "*$dockerBin*") {
    $env:PATH = "$dockerBin;$env:PATH"
}

$args = @("compose", "-f", $composeFile, "up")
if ($Detached) {
    $args += "-d"
}

Write-Host "Starting Mosquitto broker on mqtt://localhost:1883"
& $dockerPath @args
