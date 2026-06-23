# WatchSoMuch LAN Remote — task runner
# Run `just` to see all recipes.

# Show available recipes.
default:
    @just --list

# Build (if needed) and start the relay server in Docker.
up:
    docker compose up --build -d
    @echo ""
    @echo "  Relay running. On your phone open  http://<this-laptop-LAN-IP>:3000"
    @echo "  Find the IP with:  just ip"

# Start in the foreground so you can watch the logs (Ctrl+C to stop).
up-fg:
    docker compose up --build

# Stop and remove the container.
down:
    docker compose down

# Tail the server logs.
logs:
    docker compose logs -f

# Rebuild from scratch and restart.
rebuild:
    docker compose up --build -d --force-recreate

# Print this laptop's LAN IPv4 addresses (what to type into your phone).
ip:
    @powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress"
