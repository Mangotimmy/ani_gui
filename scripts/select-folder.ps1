[CmdletBinding()]
param([string]$InitialDirectory = "")

try {
    Add-Type -AssemblyName System.Windows.Forms
    
    $topForm = New-Object System.Windows.Forms.Form
    $topForm.TopMost = $true
    $topForm.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $topForm.Size = New-Object System.Drawing.Size(1, 1)
    $topForm.Opacity = 0
    $topForm.ShowInTaskbar = $false
    $topForm.Show()
    $topForm.BringToFront()
    $topForm.Activate()

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

    $result = $dialog.ShowDialog($topForm)
    $topForm.Dispose()

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
