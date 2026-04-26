param(
    [string]$BaseUrl = "http://localhost:5092",
    [int]$PollAttempts = 24,
    [int]$PollDelaySeconds = 10,
    [switch]$CleanupAfter
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Net.Http

$root = Split-Path -Parent $PSScriptRoot
$workerDir = Join-Path $root "ml-worker"
$workerPython = Join-Path $workerDir ".venv\Scripts\python.exe"
$cleanupScript = Join-Path $PSScriptRoot "cleanup-mqtt-test-data.py"
$brokerExe = "C:\Users\nikit\AppData\Local\Programs\Python\Python310\Scripts\amqtt.exe"
$tmpDir = Join-Path $env:TEMP "diplom_mqtt_smoke"
$workerOut = Join-Path $tmpDir "worker.out.log"
$workerErr = Join-Path $tmpDir "worker.err.log"
$probeImage = Join-Path $tmpDir "probe-chart.png"

New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

function New-ProbeImage {
    param([string]$Path)

    $bmp = New-Object System.Drawing.Bitmap 640, 420
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::White)

    $axisPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(45, 55, 72)), 3
    $gridPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(226, 232, 240)), 1
    $curvePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(37, 99, 235)), 4
    $labelBrush = [System.Drawing.Brushes]::DimGray
    $font = New-Object System.Drawing.Font -ArgumentList @("Segoe UI", [float]10)
    $titleFont = New-Object System.Drawing.Font -ArgumentList @("Segoe UI", [float]11, [System.Drawing.FontStyle]::Bold)

    for ($x = 90; $x -le 560; $x += 94) {
        $g.DrawLine($gridPen, $x, 50, $x, 340)
    }
    for ($y = 50; $y -le 340; $y += 58) {
        $g.DrawLine($gridPen, 90, $y, 560, $y)
    }

    $g.DrawLine($axisPen, 90, 340, 560, 340)
    $g.DrawLine($axisPen, 90, 340, 90, 50)

    $g.DrawString("0", $font, $labelBrush, 78, 344)
    $g.DrawString("1", $font, $labelBrush, 180, 344)
    $g.DrawString("2", $font, $labelBrush, 274, 344)
    $g.DrawString("3", $font, $labelBrush, 368, 344)
    $g.DrawString("4", $font, $labelBrush, 462, 344)
    $g.DrawString("5", $font, $labelBrush, 556, 344)

    $g.DrawString("5", $font, $labelBrush, 60, 44)
    $g.DrawString("4", $font, $labelBrush, 60, 102)
    $g.DrawString("3", $font, $labelBrush, 60, 160)
    $g.DrawString("2", $font, $labelBrush, 60, 218)
    $g.DrawString("1", $font, $labelBrush, 60, 276)
    $g.DrawString("0", $font, $labelBrush, 60, 334)

    $points = @(
        (New-Object System.Drawing.Point 90, 320),
        (New-Object System.Drawing.Point 140, 292),
        (New-Object System.Drawing.Point 190, 250),
        (New-Object System.Drawing.Point 240, 210),
        (New-Object System.Drawing.Point 290, 175),
        (New-Object System.Drawing.Point 340, 150),
        (New-Object System.Drawing.Point 390, 132),
        (New-Object System.Drawing.Point 440, 120),
        (New-Object System.Drawing.Point 500, 112),
        (New-Object System.Drawing.Point 560, 108)
    )

    $g.DrawLines($curvePen, $points)
    $g.DrawString("y = f(x)", $titleFont, [System.Drawing.Brushes]::IndianRed, 418, 74)

    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

    $titleFont.Dispose()
    $font.Dispose()
    $curvePen.Dispose()
    $gridPen.Dispose()
    $axisPen.Dispose()
    $g.Dispose()
    $bmp.Dispose()
}

function Test-BackendHealthy {
    param([string]$Url)

    try {
        $response = Invoke-WebRequest -Uri "$Url/health" -UseBasicParsing -TimeoutSec 5
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Ensure-BrokerRunning {
    if ((Test-NetConnection -ComputerName localhost -Port 1883).TcpTestSucceeded) {
        return
    }

    if (-not (Test-Path -LiteralPath $brokerExe)) {
        throw "MQTT broker executable not found: $brokerExe"
    }

    Start-Process -FilePath $brokerExe -WindowStyle Hidden | Out-Null
    Start-Sleep -Seconds 3

    if (-not (Test-NetConnection -ComputerName localhost -Port 1883).TcpTestSucceeded) {
        throw "MQTT broker did not open port 1883"
    }
}

function Ensure-WorkerRunning {
    $existing = Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -eq "python.exe" -and
            $_.CommandLine -match [regex]::Escape("worker_local.py")
        }

    if ($existing) {
        return
    }

    Remove-Item -LiteralPath $workerOut, $workerErr -Force -ErrorAction SilentlyContinue
    Start-Process `
        -FilePath $workerPython `
        -ArgumentList @("-u", (Join-Path $workerDir "worker_local.py")) `
        -WorkingDirectory $workerDir `
        -RedirectStandardOutput $workerOut `
        -RedirectStandardError $workerErr `
        -WindowStyle Hidden | Out-Null

    Start-Sleep -Seconds 5
}

New-ProbeImage -Path $probeImage

if (-not (Test-BackendHealthy -Url $BaseUrl)) {
    throw "Backend is not healthy on $BaseUrl. Start the .NET backend from Visual Studio first."
}

Ensure-BrokerRunning
Ensure-WorkerRunning

$stamp = Get-Date -Format "yyyyMMddHHmmss"
$email = "mqtt-live-$stamp@example.com"
$password = "Passw0rd!123"

$handler = [System.Net.Http.HttpClientHandler]::new()
$handler.UseCookies = $true
$handler.CookieContainer = [System.Net.CookieContainer]::new()
$client = [System.Net.Http.HttpClient]::new($handler)
$client.BaseAddress = [Uri]$BaseUrl

function Invoke-JsonPost {
    param(
        [string]$Path,
        [hashtable]$Body
    )

    $json = $Body | ConvertTo-Json -Compress
    $content = [System.Net.Http.StringContent]::new($json, [System.Text.Encoding]::UTF8, "application/json")
    return $client.PostAsync($Path, $content).GetAwaiter().GetResult()
}

function Get-ObjectPropertyText {
    param(
        [object]$Object,
        [string]$Name
    )

    if ($null -eq $Object) {
        return ""
    }

    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value) {
        return ""
    }

    return [string]$property.Value
}

$registerResponse = Invoke-JsonPost "/api/v1/auth/register" @{
    email = $email
    password = $password
}

if (-not $registerResponse.IsSuccessStatusCode) {
    $registerBody = $registerResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    throw "Register failed: $($registerResponse.StatusCode) $registerBody"
}

$loginResponse = Invoke-JsonPost "/api/v1/auth/login" @{
    email = $email
    password = $password
}

if (-not $loginResponse.IsSuccessStatusCode) {
    $loginBody = $loginResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    throw "Login failed: $($loginResponse.StatusCode) $loginBody"
}

$multipart = [System.Net.Http.MultipartFormDataContent]::new()
$fileBytes = [System.IO.File]::ReadAllBytes($probeImage)
$fileContent = [System.Net.Http.ByteArrayContent]::new($fileBytes)
$fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("image/png")
$multipart.Add($fileContent, "file", [System.IO.Path]::GetFileName($probeImage))

$uploadResponse = $client.PostAsync("/api/v1/charts/upload", $multipart).GetAwaiter().GetResult()
$uploadBody = $uploadResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
if (-not $uploadResponse.IsSuccessStatusCode) {
    throw "Upload failed: $($uploadResponse.StatusCode) $uploadBody"
}

$chart = $uploadBody | ConvertFrom-Json
$chartId = [int]$chart.id
Write-Output "chart_id=$chartId"
Write-Output "test_email=$email"
Write-Output "initial_status=$($chart.status)"

$terminalStatus = $null
for ($attempt = 1; $attempt -le $PollAttempts; $attempt++) {
    Start-Sleep -Seconds $PollDelaySeconds
    $response = $client.GetAsync("/api/v1/charts/$chartId").GetAwaiter().GetResult()
    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) {
        Write-Output "poll_$attempt=HTTP $($response.StatusCode) $body"
        continue
    }

    $current = $body | ConvertFrom-Json
    $status = [string]$current.status
    $errorMessage = Get-ObjectPropertyText -Object $current -Name "errorMessage"
    $nSeries = Get-ObjectPropertyText -Object $current -Name "nSeries"
    Write-Output ("poll_{0}=status:{1};series:{2};error:{3}" -f $attempt, $status, $nSeries, $errorMessage)

    if ($status -eq "done" -or $status -eq "error") {
        $terminalStatus = $status
        break
    }
}

if ($CleanupAfter) {
    & $workerPython $cleanupScript --apply --email $email
}

if ($terminalStatus -eq "done") {
    Write-Output "smoke_check=passed"
    exit 0
}

if ($terminalStatus -eq "error") {
    Write-Output "smoke_check=failed"
    exit 2
}

Write-Output "smoke_check=timeout"
exit 3
