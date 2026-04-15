import dgram from "node:dgram";

const BULB_IP = "192.168.1.6";
const LOCAL_IP = "192.168.1.3";
const PORT = 38899;

const socket = dgram.createSocket("udp4");

socket.on("error", (err) => {
  console.error("Socket error:", err);
  socket.close();
});

socket.on("message", (msg, rinfo) => {
  console.log("Response from", rinfo.address, ":", msg.toString());
});

socket.bind(0, LOCAL_IP, () => {
  console.log(`Bound to ${LOCAL_IP}, sending getPilot to ${BULB_IP}...`);

  const payload = Buffer.from(JSON.stringify({
    method: "getPilot",
    params: {}
  }));

  socket.send(payload, PORT, BULB_IP, (err) => {
    if (err) {
      console.error("Send failed:", err);
    } else {
      console.log("Command sent!");
    }
  });

  setTimeout(() => {
    console.log("No response within 5 seconds, closing.");
    socket.close();
  }, 5000);
});