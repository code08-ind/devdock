/** Captured-style outputs of the port scanner's commands (macOS and Windows), trimmed. */

/** `lsof +c 0 -nP -iTCP -sTCP:LISTEN` on macOS 15 (full names; spaces as `\x20`). */
export const LSOF = `COMMAND     PID      USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
rapportd    612 developer    8u  IPv4 0x8f1c2e0ab1c2d3e4      0t0  TCP *:49152 (LISTEN)
rapportd    612 developer    9u  IPv6 0x8f1c2e0ab1c2d3e5      0t0  TCP *:49152 (LISTEN)
node      41873 developer   23u  IPv6 0x8f1c2e0ab1c2d3e6      0t0  TCP [::1]:5173 (LISTEN)
node      41873 developer   24u  IPv4 0x8f1c2e0ab1c2d3e7      0t0  TCP 127.0.0.1:5173 (LISTEN)
node      41990 developer   21u  IPv4 0x8f1c2e0ab1c2d3e8      0t0  TCP *:3000 (LISTEN)
node      42001 developer   21u  IPv6 0x8f1c2e0ab1c2d3e9      0t0  TCP *:3000 (LISTEN)
com.docke  1777 developer  123u  IPv6 0x8f1c2e0ab1c2d3ea      0t0  TCP *:8080 (LISTEN)
Google\\x20Chrome\\x20Helper 9001 developer   40u  IPv6 0x8f1c2e0ab1c2d3eb      0t0  TCP [fe80::1%lo0]:7000 (LISTEN)
`

/** `ps -o pid=,args= -p …` for those PIDs. */
export const PS = `  612 /usr/libexec/rapportd
41873 node /Users/developer/web-app/node_modules/.bin/vite --port 5173
41990 node server.js
42001 node /Users/developer/api/dist/main.js
 1777 /Applications/Docker.app/Contents/MacOS/com.docker.backend
`

/** `netstat -ano -p tcp` on Windows 11 (English). */
export const NETSTAT_V4 = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1032
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       8812
  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       9120
  TCP    127.0.0.1:5173         127.0.0.1:52144        ESTABLISHED     9120
  TCP    192.168.1.20:52144     140.82.112.3:443       ESTABLISHED     7720
`

/** `netstat -ano -p tcpv6` (same server on IPv6, another on [::1]). */
export const NETSTAT_V6 = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    [::]:135               [::]:0                 LISTENING       1032
  TCP    [::]:3000              [::]:0                 LISTENING       8812
  TCP    [::1]:8080             [::]:0                 LISTENING       4410
`

/** German Windows: the State column is translated. */
export const NETSTAT_DE = `
Aktive Verbindungen

  Proto  Lokale Adresse         Remoteadresse          Status           PID
  TCP    0.0.0.0:5173           0.0.0.0:0              ABHÖREN          9120
  TCP    127.0.0.1:5173         127.0.0.1:52144        HERGESTELLT      9120
`

/** `tasklist /FO CSV /NH`. */
export const TASKLIST = `"System Idle Process","0","Services","0","8 K"
"svchost.exe","1032","Services","0","12,344 K"
"node.exe","8812","Console","1","45,120 K"
"node.exe","9120","Console","1","98,004 K"
"java.exe","4410","Console","1","512,880 K"
`
