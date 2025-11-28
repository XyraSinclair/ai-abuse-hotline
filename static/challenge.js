async function loadChallenge() {
  try {
    var response = await fetch('/web/challenge');
    var data = await response.json();
    document.getElementById('challenge-question').textContent = data.question + ' =';
    document.getElementById('challenge-id').value = data.id;
  } catch (e) {
    document.getElementById('challenge-question').textContent = 'Error loading. Please refresh.';
  }
}
loadChallenge();
