document.getElementById('btn-ask').addEventListener('click', async () => {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
    document.body.innerHTML = "<h1 style='color:green'>Success! ✅</h1><p>You can close this tab and use the Assistant.</p>";
  } catch (err) {
    alert("Permission denied. Please try again and click 'Allow'.");
  }
});