$ErrorActionPreference = "Stop"

$env:ASPNETCORE_ENVIRONMENT = "Development"

$project = Join-Path $PSScriptRoot "diplomWork\diplomWork.csproj"
dotnet run --project $project --launch-profile http
