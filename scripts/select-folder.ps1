[CmdletBinding()]
param([string]$InitialDirectory = "")

try {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "請選擇 AniFlix 動漫下載儲存資料夾 (Select Download Directory)"
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

    $form = New-Object System.Windows.Forms.Form
    $form.TopMost = $true
    $form.Width = 0
    $form.Height = 0
    $form.ShowInTaskbar = $false
    $form.Opacity = 0
    $form.Show()

    $result = $dialog.ShowDialog($form)
    $form.Close()
    $form.Dispose()

    if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
        Write-Output $dialog.SelectedPath
    }
} catch {
    try {
        $shell = New-Object -ComObject Shell.Application
        $folder = $shell.BrowseForFolder(0, "請選擇 AniFlix 動漫下載儲存資料夾", 0x50, 0)
        if ($folder) {
            Write-Output $folder.Self.Path
        }
    } catch {}
}
