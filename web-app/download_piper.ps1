$tempZip = "$env:TEMP\piper_windows.zip"
$tempExt = "$env:TEMP\piper_ext"
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $scriptPath "resources\piper"

Write-Host "Creating destination folder: $dest"
New-Item -ItemType Directory -Force -Path $dest

if (Test-Path "$dest\en_US-amy-medium.onnx") {
    Remove-Item -Path "$dest\en_US-amy-medium.onnx" -Force
}

Write-Host "Downloading Piper ZIP using curl..."
curl.exe -L -o "$tempZip" "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip"

Write-Host "Extracting ZIP..."
Expand-Archive -Path $tempZip -DestinationPath $tempExt -Force

Write-Host "Copying files..."
if (Test-Path "$tempExt\piper") {
    Copy-Item -Path "$tempExt\piper\*" -Destination $dest -Recurse -Force
} else {
    Copy-Item -Path "$tempExt\*" -Destination $dest -Recurse -Force
}

Write-Host "Downloading en_US-amy-medium.onnx using curl..."
curl.exe -L -o "$dest\en_US-amy-medium.onnx" "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx"

Write-Host "Downloading en_US-amy-medium.onnx.json using curl..."
curl.exe -L -o "$dest\en_US-amy-medium.onnx.json" "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx.json"

Write-Host "Cleaning up temp zip/extract..."
Remove-Item -Path $tempZip -Force
if (Test-Path $tempExt) {
    Remove-Item -Path $tempExt -Recurse -Force
}

Write-Host "Done!"
