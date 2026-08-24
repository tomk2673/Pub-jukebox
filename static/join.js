document.getElementById("joinForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const code = document.getElementById("code").value.trim();
  if (!code) return;
  window.location.assign(`/guest?code=${encodeURIComponent(code)}`);
});
