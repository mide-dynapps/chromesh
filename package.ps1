<#
    Empaquette l'extension dans dist/chromesh-<version>.zip.

    Le ZIP est destine a une distribution interne : le destinataire le
    decompresse, puis charge le DOSSIER decompresse via "Charger l'extension
    non empaquetee". Edge et Chrome n'installent pas un .zip directement.
#>
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

$version = (Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json).version
$staging = Join-Path $root 'dist\chromesh'
$archive = Join-Path $root "dist\chromesh-$version.zip"

if (Test-Path (Join-Path $root 'dist')) { Remove-Item (Join-Path $root 'dist') -Recurse -Force }
New-Item -ItemType Directory -Path $staging -Force | Out-Null

# Seul ce qui est necessaire a l'execution, plus le README et le CHANGELOG pour le destinataire.
foreach ($item in @('manifest.json', 'README.md', 'CHANGELOG.md', 'src', 'icons')) {
    Copy-Item (Join-Path $root $item) -Destination $staging -Recurse
}

# Les entrees sont ecrites une a une avec un nom normalise en '/'. Ni
# Compress-Archive ni ZipFile::CreateFromDirectory ne le font sous PowerShell
# 5.1 / .NET Framework : tous deux posent des antislashs, que 7-Zip et les
# outils Linux ne reconstruisent pas en arborescence.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($archive, 'Create')
try {
    foreach ($file in Get-ChildItem $staging -Recurse -File) {
        $name = $file.FullName.Substring($staging.Length + 1).Replace(
            [System.IO.Path]::DirectorySeparatorChar, '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip, $file.FullName, $name,
            [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally {
    $zip.Dispose()
}

Remove-Item $staging -Recurse -Force

$size = [math]::Round((Get-Item $archive).Length / 1KB, 1)
Write-Output "$archive  ($size Ko)"
