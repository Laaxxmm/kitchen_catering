param(
  [Parameter(Mandatory=$true)]
  [string]$PasswordFile
)

# One-time Postgres superuser password reset + creation of the
# indefine_kitchen role and database. Runs as Administrator.
#
# Reads the new postgres superuser password from $PasswordFile (a temp file
# the caller writes, this script deletes). The password never lives inside
# this script and never gets logged.
#
# Steps:
#   1. Back up pg_hba.conf -> pg_hba.conf.ikbak
#   2. Swap localhost auth from scram-sha-256 to trust
#   3. Restart postgresql-x64-18
#   4. Connect as postgres (no password): set password, create role + DB
#   5. Restore pg_hba.conf from backup
#   6. Restart postgresql-x64-18 again
#   7. Verify the new postgres password works
#   8. Write postgres + indefine_kitchen creds to %APPDATA%\postgresql\pgpass.conf
#
# Emits "PHASE0_DB_RESET_OK" on success. No secrets are echoed to the console.

$ErrorActionPreference = "Stop"
$LogPath = "H:\RESTAURANT\indefine-kitchen\scripts\reset-postgres.log"
Start-Transcript -Path $LogPath -Force | Out-Null
trap { Write-Output ("FATAL: " + $_.Exception.Message); Stop-Transcript | Out-Null; exit 1 }

$PGBIN = "C:\Program Files\PostgreSQL\18\bin"
$PGDATA = "C:\Program Files\PostgreSQL\18\data"
$HBA = Join-Path $PGDATA "pg_hba.conf"
$HBABAK = Join-Path $PGDATA "pg_hba.conf.ikbak"
$SVC = "postgresql-x64-18"
$IK_ROLE = "indefine_kitchen"
$IK_PWD = "localdev_changeme"   # matches the DATABASE_URL already in .env

# --- Read the new postgres superuser password from the caller-supplied file,
#     then delete the file so the secret only lives in pgpass.conf afterwards. ---
if (-not (Test-Path $PasswordFile)) { throw "PasswordFile not found: $PasswordFile" }
$PG_PWD = [System.IO.File]::ReadAllText($PasswordFile).TrimEnd("`r","`n")
if ([string]::IsNullOrEmpty($PG_PWD)) { throw "PasswordFile empty" }
Remove-Item $PasswordFile -Force

function Wait-Service {
  param([string]$Name, [string]$Want)
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    $s = Get-Service -Name $Name
    if ($s.Status -eq $Want) { return }
    Start-Sleep -Milliseconds 500
  }
  throw "Service $Name did not reach state $Want"
}

# 1. Back up pg_hba.conf
Copy-Item $HBA $HBABAK -Force

# 2. Swap auth methods to trust on the local lines only
$content = Get-Content $HBA -Raw
$content = $content -replace '(?m)^(local\s+all\s+all\s+)scram-sha-256', '$1trust'
$content = $content -replace '(?m)^(host\s+all\s+all\s+127\.0\.0\.1/32\s+)scram-sha-256', '$1trust'
$content = $content -replace '(?m)^(host\s+all\s+all\s+::1/128\s+)scram-sha-256', '$1trust'
Set-Content -Path $HBA -Value $content -Encoding ascii

# 3. Restart Postgres
Restart-Service -Name $SVC -Force
Wait-Service -Name $SVC -Want "Running"
Start-Sleep -Seconds 2  # let it accept connections

# 4. Reset postgres password + create indefine_kitchen role and DB
$env:PGPASSWORD = ""  # no password while in trust mode
$pg_pwd_escaped = $PG_PWD -replace "'", "''"
$ik_pwd_escaped = $IK_PWD -replace "'", "''"
$sql = @"
ALTER USER postgres WITH PASSWORD '$pg_pwd_escaped';
DO `$do`$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$IK_ROLE') THEN
    EXECUTE 'CREATE ROLE $IK_ROLE WITH LOGIN PASSWORD ''$ik_pwd_escaped''';
  END IF;
END `$do`$;
SELECT 'db_exists' WHERE EXISTS (SELECT 1 FROM pg_database WHERE datname = '$IK_ROLE');
"@

$sqlPath = Join-Path $env:TEMP "ik-pg-reset.sql"
Set-Content -Path $sqlPath -Value $sql -Encoding ascii

$psql = Join-Path $PGBIN "psql.exe"
$out = & $psql -U postgres -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -f $sqlPath 2>&1
if ($LASTEXITCODE -ne 0) {
  Remove-Item $sqlPath -Force
  throw "psql step 1 failed: $out"
}

# Create the DB only if it doesn't already exist (CREATE DATABASE can't be in a DO block).
$dbExists = & $psql -U postgres -h 127.0.0.1 -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$IK_ROLE'"
if ($dbExists -ne "1") {
  & $psql -U postgres -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $IK_ROLE OWNER $IK_ROLE;" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "CREATE DATABASE failed" }
}
& $psql -U postgres -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -c "GRANT ALL PRIVILEGES ON DATABASE $IK_ROLE TO $IK_ROLE;" | Out-Null

Remove-Item $sqlPath -Force

# 5. Restore pg_hba.conf
Copy-Item $HBABAK $HBA -Force
Remove-Item $HBABAK -Force

# 6. Restart Postgres so scram-sha-256 is back in effect
Restart-Service -Name $SVC -Force
Wait-Service -Name $SVC -Want "Running"
Start-Sleep -Seconds 2

# 7. Verify the new postgres password works
$env:PGPASSWORD = $PG_PWD
$probe = & $psql -U postgres -h 127.0.0.1 -d postgres -tAc "SELECT 1;" 2>&1
if ($LASTEXITCODE -ne 0 -or "$probe".Trim() -ne "1") {
  throw "verify failed: $probe"
}

# 8. Write pgpass.conf with both credentials. Format: host:port:database:user:password
$pgpassDir = Join-Path $env:APPDATA "postgresql"
if (-not (Test-Path $pgpassDir)) { New-Item -ItemType Directory -Path $pgpassDir | Out-Null }
$pgpass = Join-Path $pgpassDir "pgpass.conf"
$lines = @(
  "localhost:5432:*:postgres:$PG_PWD",
  "127.0.0.1:5432:*:postgres:$PG_PWD",
  "localhost:5432:${IK_ROLE}:${IK_ROLE}:$IK_PWD",
  "127.0.0.1:5432:${IK_ROLE}:${IK_ROLE}:$IK_PWD"
)
Set-Content -Path $pgpass -Value ($lines -join "`r`n") -Encoding ascii
# Restrict the file ACL to the current user so other users on the box can't read it
icacls $pgpass /inheritance:r /grant:r "$env:USERNAME:F" | Out-Null

$env:PGPASSWORD = ""
Write-Output "PHASE0_DB_RESET_OK"
Write-Output "pgpass.conf written to $pgpass"
Stop-Transcript | Out-Null
