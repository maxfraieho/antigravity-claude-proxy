import sys
import json
import subprocess
import os

SERVER_INFO = {
    "name": "screenshot-mcp",
    "version": "1.0.0"
}

TOOLS = [
    {
        "name": "take_screenshot",
        "description": "Capture a desktop screenshot on Windows and save it as a PNG file. Returns the absolute file path of the captured screenshot.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "filename": {
                    "type": "string",
                    "description": "Optional custom filename for the screenshot (e.g. 'crush_session.png')"
                },
                "outdir": {
                    "type": "string",
                    "description": "Optional custom output directory path"
                }
            }
        }
    }
]

def send_response(response):
    payload = json.dumps(response)
    sys.stdout.write(payload + "\n")
    sys.stdout.flush()

def handle_request(req):
    req_id = req.get("id")
    method = req.get("method")
    params = req.get("params", {})

    if method == "initialize":
        send_response({
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {}
                },
                "serverInfo": SERVER_INFO
            }
        })
    elif method == "notifications/initialized":
        pass
    elif method == "ping":
        send_response({
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {}
        })
    elif method == "tools/list":
        send_response({
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "tools": TOOLS
            }
        })
    elif method == "tools/call":
        name = params.get("name")
        args = params.get("arguments", {})
        if name == "take_screenshot":
            ps_script = r"C:\Users\vokov\bin\take-screenshot.ps1"
            cmd = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps_script]
            if "filename" in args and args["filename"]:
                cmd.extend(["-FileName", args["filename"]])
            if "outdir" in args and args["outdir"]:
                cmd.extend(["-OutDir", args["outdir"]])
            try:
                proc = subprocess.run(cmd, capture_output=True, text=True, check=True)
                path = proc.stdout.strip()
                send_response({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": f"Screenshot successfully captured and saved to: {path}"
                            }
                        ]
                    }
                })
            except Exception as e:
                send_response({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "isError": True,
                        "content": [
                            {
                                "type": "text",
                                "text": f"Failed to take screenshot: {str(e)}"
                            }
                        ]
                    }
                })
        else:
            send_response({
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {
                    "code": -32601,
                    "message": f"Tool '{name}' not found"
                }
            })
    else:
        if req_id is not None:
            send_response({
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {
                    "code": -32601,
                    "message": f"Method '{method}' not found"
                }
            })

def main():
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                sys.exit(0)
            line = line.strip()
            if not line:
                continue
            req = json.loads(line)
            handle_request(req)
        except (KeyboardInterrupt, SystemExit):
            sys.exit(0)
        except Exception as e:
            sys.stderr.write(f"Screenshot MCP error: {e}\n")
            sys.stderr.flush()

if __name__ == "__main__":
    main()
