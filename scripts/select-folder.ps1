[CmdletBinding()]
param([string]$InitialDirectory = "")

try {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "Select AniFlix Download Folder"
    $dialog.AutoUpgradeEnabled = $true
    $dialog.ShowNewFolderButton = $true

    if ($InitialDirectory -and (Test-Path $InitialDirectory)) {
        $dialog.SelectedPath = $InitialDirectory
    } else {
        $downloads = [System.IO.Path]::Combine($env:USERPROFILE, "Downloads")
        if (Test-Path $downloads) {
            $dialog.SelectedPath = $downloads
        }
    }

    $result = $dialog.ShowDialog()
    if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
        Write-Output $dialog.SelectedPath
    }
} catch {
    try {
        $shell = New-Object -ComObject Shell.Application
        $folder = $shell.BrowseForFolder(0, "Select AniFlix Download Folder", 0x50, 0)
        if ($folder) {
            Write-Output $folder.Self.Path
        }
    } catch {}
}
