[CmdletBinding()]
param([string]$InitialDirectory = "")

try {
    # Method 1: Windows Shell COM object (lightweight, native, zero WinForms Form deadlocks)
    $shell = New-Object -ComObject Shell.Application
    # 0x0040 = BIF_NEWDIALOGSTYLE (resizable, includes Make New Folder button)
    $folder = $shell.BrowseForFolder(0, "選擇 AniFlix 下載儲存目錄 (Select Download Folder)", 0x40, 0)
    if ($folder -and $folder.Self -and $folder.Self.Path) {
        Write-Output $folder.Self.Path
        exit 0
    }
} catch {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
        $dialog.Description = "Select AniFlix Download Folder"
        $dialog.ShowNewFolderButton = $true
        if ($InitialDirectory -and (Test-Path $InitialDirectory)) {
            $dialog.SelectedPath = $InitialDirectory
        }
        if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            Write-Output $dialog.SelectedPath
            exit 0
        }
    } catch {}
}
