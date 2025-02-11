"use strict";

// Set the CSS variable to the actual viewport height
let vh = window.innerHeight * 0.01;
document.documentElement.style.setProperty('--vh', `${vh}px`);


// -----------------------------
// Global Variables & API Keys
// -----------------------------
let autocomplete;
let selectedPlace;
let allTideStations = null;
const OPENWEATHER_API_KEY = "b0a3cf6cb3e481420a128390e596ef94"; // Replace with your key
let currentWeatherData = null;
let map = null;
let tideMarkers = [];
let userMarker = null;
let tideStationsData = null;

// -----------------------------
// New: Clearer In‑Page Notifications
// -----------------------------
function showNotification(message, type = 'error', duration = 3000) {
  const notification = document.getElementById("notification");
  notification.textContent = message;
  notification.className = ""; // clear any existing class
  notification.classList.add(type);
  notification.style.display = "block";
  setTimeout(() => {
    notification.style.display = "none";
  }, duration);
}

// Use showNotification in place of alert()
function showError(message) {
  showNotification(message, 'error');
}


// -----------------------------
// New: Tide Chart using Chart.js
// -----------------------------
function renderTideChart(tidePredictions) {
  // Create or get a canvas element in the modal
  let chartCanvas = document.getElementById("tideChart");
  if (!chartCanvas) {
    chartCanvas = document.createElement("canvas");
    chartCanvas.id = "tideChart";
    document.getElementById("modal-content").appendChild(chartCanvas);
  }
  
  // Prepare labels and data
  const labels = tidePredictions.map(pred => {
    const date = new Date(pred.t);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: 'numeric' });
  });
  const data = tidePredictions.map(pred => parseFloat(pred.v));
  
  const ctx = chartCanvas.getContext('2d');
  // Destroy an existing chart instance if any
  if (chartCanvas.chartInstance) {
    chartCanvas.chartInstance.destroy();
  }
  chartCanvas.chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Tide Height (ft)',
        data: data,
        borderColor: '#0072ff',
        backgroundColor: 'rgba(0,114,255,0.2)',
        fill: true,
        tension: 0.2
      }]
    },
    options: {
      scales: {
        y: { beginAtZero: false }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

// -----------------------------
// Helper Functions (General)
// -----------------------------
function showLoader(show = true) {
  const loader = document.getElementById("loader");
  loader.style.display = show ? "block" : "none";
}

function toRadians(deg) {
  return deg * Math.PI / 180;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
            Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Helper to close the auth forms
function closeAuthForms() {
  document.getElementById("formsContainer").style.display = "none";
}

// Attach event listeners to the close buttons in the auth forms
document.querySelectorAll(".close-auth").forEach(btn => {
  btn.addEventListener("click", closeAuthForms);
});

// -----------------------------
// User Authentication & Favorites
// -----------------------------
function getAllUsers() {
  const usersJSON = localStorage.getItem("snorkelUsers");
  return usersJSON ? JSON.parse(usersJSON) : {};
}

function saveAllUsers(usersObj) {
  localStorage.setItem("snorkelUsers", JSON.stringify(usersObj));
}

function isValidPassword(password) {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /[0-9]/.test(password);
}

function registerUser(username, password) {
  const users = getAllUsers();
  if (users[username]) {
    showError("That username is already taken. Please choose another.");
    return false;
  }
  if (!isValidPassword(password)) {
    showError("Password must be at least 8 characters and contain letters and digits.");
    return false;
  }
  users[username] = { password };
  saveAllUsers(users);
  showNotification("Registration successful! You can now sign in.", 'success');
  return true;
}

function signInUser(username, password) {
  const users = getAllUsers();
  const userData = users[username];
  if (!userData) {
    showError("No such user. Please register first.");
    return false;
  }
  if (userData.password !== password) {
    showError("Incorrect password. Please try again.");
    return false;
  }
  setCurrentUser(username);
  return true;
}

function getCurrentUser() {
  const userJSON = localStorage.getItem("snorkelUser");
  return userJSON ? JSON.parse(userJSON) : null;
}

function setCurrentUser(username) {
  localStorage.setItem("snorkelUser", JSON.stringify({ username }));
}

function signOutUser() {
  localStorage.removeItem("snorkelUser");
}

function loadFavorites(username) {
  const key = `favorites_${username}`;
  const favJSON = localStorage.getItem(key);
  return favJSON ? JSON.parse(favJSON) : [];
}

function saveFavorites(username, favorites) {
  const key = `favorites_${username}`;
  localStorage.setItem(key, JSON.stringify(favorites));
}

// -----------------------------
// Enhanced Favorites Management
// -----------------------------
function toggleFavoriteStation(stationObj) {
  const user = getCurrentUser();
  if (!user) {
    showNotification("Please sign in to save favorites.", 'error');
    return;
  }
  const username = user.username;
  let favorites = loadFavorites(username);
  const index = favorites.findIndex((fav) => fav.stationId === stationObj.stationId);
  if (index >= 0) {
    // Remove favorite
    favorites.splice(index, 1);
    showNotification(`Removed ${stationObj.stationName} from favorites.`, 'success');
  } else {
    // Prompt for a custom note (optional)
    const note = prompt("Add a custom note for this favorite (optional):", "");
    stationObj.note = note;
    stationObj.lastFetched = new Date().toISOString();
    favorites.push(stationObj);
    showNotification(`Added ${stationObj.stationName} to favorites.`, 'success');
  }
  saveFavorites(username, favorites);
  renderFavorites();
}

function renderFavorites() {
  const user = getCurrentUser();
  if (!user) return;
  const favoritesList = document.getElementById("favoritesList");
  if (!favoritesList) return;
  const favorites = loadFavorites(user.username);
  favoritesList.innerHTML = "";
  if (favorites.length === 0) {
    favoritesList.innerHTML = "<p>No favorite spots yet.</p>";
    return;
  }
  favorites.forEach((fav, idx) => {
    const div = document.createElement("div");
    div.className = "favorite-item";
    // Checkbox for multi-select deletion
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.index = idx;
    div.appendChild(checkbox);
    // Thumbnail/icon placeholder
    const img = document.createElement("img");
    img.src = "favorite-icon.png"; // Replace with your icon path
    img.alt = fav.stationName;
    div.appendChild(img);
    // Info (including custom note and last-fetched timestamp)
    const infoDiv = document.createElement("div");
    infoDiv.className = "favorite-info";
    infoDiv.innerHTML = `<strong>${fav.stationName}</strong><br>
      Note: ${fav.note || "None"}<br>
      Last Fetched: ${new Date(fav.lastFetched).toLocaleString()}`;
    infoDiv.addEventListener("click", () => {
      handleFavoriteClick(fav);
    });
    div.appendChild(infoDiv);
    favoritesList.appendChild(div);
  });
}

async function handleFavoriteClick(favStation) {
  try {
    const predictions = await getTidePredictions(favStation.stationId);
    const weatherData = await fetchWeatherData(favStation.stationLat, favStation.stationLng);
    if (!weatherData) {
      showError("Could not fetch weather data. Please try again.");
      return;
    }
    const stationObj = {
      stationName: favStation.stationName,
      stationId: favStation.stationId,
      stationLat: favStation.stationLat,
      stationLng: favStation.stationLng,
      predictions
    };
    showFullStationDetail(stationObj, weatherData);
  } catch (error) {
    console.error("Error fetching favorite station data:", error);
    showError("Could not fetch tide data for this station. Please try again.");
  }
}

function deleteSelectedFavorites() {
  const user = getCurrentUser();
  if (!user) return;
  let favorites = loadFavorites(user.username);
  const checkboxes = document.querySelectorAll("#favoritesList input[type='checkbox']");
  const indicesToDelete = [];
  checkboxes.forEach(cb => {
    if (cb.checked) {
      indicesToDelete.push(parseInt(cb.dataset.index, 10));
    }
  });
  if (indicesToDelete.length === 0) {
    showNotification("No favorites selected for deletion.", 'error');
    return;
  }
  favorites = favorites.filter((fav, idx) => !indicesToDelete.includes(idx));
  saveFavorites(user.username, favorites);
  renderFavorites();
  showNotification("Selected favorites removed.", 'success');
}

function updateAuthUI() {
  const user = getCurrentUser();
  const registerLink = document.getElementById("registerLink");
  const signInLink = document.getElementById("signInLink");
  const signOutLink = document.getElementById("signOutLink");
  const viewFavoritesLink = document.getElementById("viewFavoritesLink");
  const formsContainer = document.getElementById("formsContainer");
  const favoritesContainer = document.getElementById("favoritesContainer");

  if (user) {
    signOutLink.style.display = "inline-block";
    viewFavoritesLink.style.display = "inline-block";
    registerLink.style.display = "none";
    signInLink.style.display = "none";
    formsContainer.style.display = "none";
    renderFavorites();
  } else {
    registerLink.style.display = "inline-block";
    signInLink.style.display = "inline-block";
    signOutLink.style.display = "none";
    viewFavoritesLink.style.display = "none";
    favoritesContainer.style.display = "none";
    formsContainer.style.display = "none";
  }
}

function showRegisterForm() {
  document.getElementById("formsContainer").style.display = "block";
  document.getElementById("registerForm").style.display = "block";
  document.getElementById("signInForm").style.display = "none";
}

function showSignInForm() {
  document.getElementById("formsContainer").style.display = "block";
  document.getElementById("registerForm").style.display = "none";
  document.getElementById("signInForm").style.display = "block";
}

function toggleFavoritesContainer() {
  const favoritesContainer = document.getElementById("favoritesContainer");
  favoritesContainer.style.display = (favoritesContainer.style.display === "none" || !favoritesContainer.style.display)
    ? "block" : "none";
}

// -----------------------------
// Google Maps & Places
// -----------------------------
function initializeAutocomplete() {
  const input = document.getElementById("location");
  if (!input) return console.error("Location input not found.");
  autocomplete = new google.maps.places.Autocomplete(input, {
    types: ["geocode"],
    componentRestrictions: { country: "us" }
  });
  autocomplete.addListener("place_changed", async () => {
    const place = autocomplete.getPlace();
    if (!place || !place.geometry) {
      showNotification("No valid location selected. Please try again.", 'error');
      return;
    }
    selectedPlace = {
      name: place.formatted_address,
      lat: place.geometry.location.lat(),
      lng: place.geometry.location.lng()
    };
    centerMapAndPlaceUserMarker(selectedPlace.lat, selectedPlace.lng);
    displayLocationInfo(selectedPlace.name, selectedPlace.lat, selectedPlace.lng);
    await displayWeatherForLocation(selectedPlace.lat, selectedPlace.lng);
    fetchTideData(selectedPlace.lat, selectedPlace.lng);
  });
}

function centerMapAndPlaceUserMarker(lat, lng) {
  map.setCenter({ lat, lng });
  if (userMarker) userMarker.setMap(null);
  userMarker = new google.maps.Marker({
    position: { lat, lng },
    map,
    title: "Selected Location"
  });
}

// -----------------------------
// Location, Weather, and Tides
// -----------------------------
function displayLocationInfo(name, lat, lng) {
  const resultDiv = document.getElementById("result");
  if (!resultDiv) return;
  resultDiv.style.display = "block";
  resultDiv.innerHTML = `
    <h2>Selected Location</h2>
    <p><strong>${name}</strong></p>
    <p><strong>Latitude:</strong> ${lat}</p>
    <p><strong>Longitude:</strong> ${lng}</p>
    <div id="weatherInfo">
      <h3>Loading Weather Information...</h3>
    </div>
    <div id="tideInfo">
      <h3>Loading Tide Information...</h3>
    </div>
  `;
}

// NEW: Helper to build an hourly forecast table (for the overlay only)
function generateHourlyForecastTable(weatherData) {
  const hourlyData = weatherData.hourly || [];
  const next6Hours = hourlyData.slice(0, 6);
  let tableHTML = `<table class="forecast-table">
    <thead>
      <tr>
        <th>Time</th>
        <th>Temp (°F)</th>
        <th>Wind (mph)</th>
        <th>Weather</th>
      </tr>
    </thead>
    <tbody>`;
  next6Hours.forEach(hour => {
    const hourTime = new Date(hour.dt * 1000);
    const timeStr = hourTime.toLocaleTimeString([], { hour: "numeric", minute: "numeric", hour12: true });
    const weatherDesc = (hour.weather && hour.weather[0])
      ? hour.weather[0].description.charAt(0).toUpperCase() + hour.weather[0].description.slice(1)
      : "N/A";
    tableHTML += `
      <tr>
        <td>${timeStr}</td>
        <td>${hour.temp}</td>
        <td>${hour.wind_speed}</td>
        <td>${weatherDesc}</td>
      </tr>
    `;
  });
  tableHTML += `</tbody></table>`;
  return tableHTML;
}

async function getAllTideStations() {
  if (allTideStations) return allTideStations;
  const stationsUrl = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions";
  const response = await fetch(stationsUrl);
  if (!response.ok) throw new Error(`Failed to fetch tide stations. Status: ${response.status}`);
  const data = await response.json();
  allTideStations = data.stations || data.stationList || [];
  return allTideStations;
}

async function getTidePredictions(stationId) {
  const tideUrl = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=today&station=${stationId}&product=predictions&datum=MLLW&time_zone=lst_ldt&interval=hilo&units=english&format=json&application=SnorkelApp`;
  const response = await fetch(tideUrl);
  if (!response.ok) throw new Error(`Error fetching tide predictions for station ${stationId}. Status: ${response.status}`);
  const data = await response.json();
  return data.predictions || [];
}

async function fetchTideData(lat, lon) {
  showLoader(true);
  try {
    const stations = await getAllTideStations();
    stations.forEach((station) => {
      station.distance = haversineDistance(lat, lon, station.lat, station.lng);
    });
    const closestThree = stations.sort((a, b) => a.distance - b.distance).slice(0, 3);
    const tideDataPromises = closestThree.map(async (station) => {
      const predictions = await getTidePredictions(station.id);
      return {
        stationName: station.name,
        stationId: station.id,
        stationLat: station.lat,
        stationLng: station.lng,
        predictions
      };
    });
    const tideData = await Promise.all(tideDataPromises);
    displayTideData(tideData);
    addTideStationMarkers(closestThree);
  } catch (err) {
    console.error("Error fetching tide data:", err);
    showError("Failed to fetch tide data. Please try again later.");
  } finally {
    showLoader(false);
  }
}

function addTideStationMarkers(stations) {
  // Remove any existing markers
  tideMarkers.forEach((m) => m.setMap(null));
  tideMarkers = [];
  
  // Create a LatLngBounds object to automatically adjust the map's viewport
  const bounds = new google.maps.LatLngBounds();
  
  stations.forEach((station, index) => {
    const position = { lat: station.lat, lng: station.lng };
    const marker = new google.maps.Marker({
      position: position,
      map: map,
      title: station.name,
      label: (index + 1).toString()
    });
    tideMarkers.push(marker);
    
    // Extend the bounds to include this marker's position
    bounds.extend(marker.getPosition());
    
    // Add a click listener to open the station details when the marker is clicked
    marker.addListener("click", () => showTideStationDetail(index));
  });
  
  // Adjust the map viewport so that all markers are visible
  map.fitBounds(bounds);
}


function displayTideData(tideData) {
  tideStationsData = tideData;
  const tideDiv = document.getElementById("tideInfo");
  if (!tideDiv) return;
  // Updated header with clearer instructions:
  let tideHTML = `
    <h2>Closest Tide Stations</h2>
    <p>
      Click the numbered markers on the map <strong>(1, 2, 3)</strong><br />
      or scroll and click the station name below for more details.
    </p>
  `;
  const user = getCurrentUser();
  tideData.forEach((station, index) => {
    let starHTML = "";
    if (user) {
      const stationObjString = encodeURIComponent(JSON.stringify({
        stationName: station.stationName,
        stationId: station.stationId,
        stationLat: station.stationLat,
        stationLng: station.stationLng
      }));
      starHTML = `<button class="favoriteBtn" data-station-obj="${stationObjString}" title="Add to favorites">⭐</button>`;
    }
    tideHTML += `
      <div>
        <h3 class="tide-station" data-index="${index}">${station.stationName}</h3>
        ${starHTML}
        <ul>
          ${station.predictions.map(prediction => {
            const date = new Date(prediction.t);
            const timeString = date.toLocaleString("en-US", { hour: "numeric", minute: "numeric", hour12: true });
            const tideType = prediction.type === "H" ? "High tide" : "Low tide";
            return `<li>${tideType} at ${timeString} with a height of ${prediction.v} ft</li>`;
          }).join("")}
        </ul>
      </div>
    `;
  });
  tideDiv.innerHTML = tideHTML;
  document.querySelectorAll(".tide-station").forEach(el => {
    el.addEventListener("click", () => {
      const idx = parseInt(el.getAttribute("data-index"), 10);
      if (!isNaN(idx)) showTideStationDetail(idx);
    });
  });
  document.querySelectorAll(".favoriteBtn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const stationObj = JSON.parse(decodeURIComponent(e.target.getAttribute("data-station-obj")));
      toggleFavoriteStation(stationObj);
    });
  });
}

function showTideStationDetail(index) {
  if (!tideStationsData || !tideStationsData[index]) {
    console.warn("Invalid station index:", index);
    return;
  }
  const station = tideStationsData[index];
  showFullStationDetail(station, currentWeatherData);
}

function analyzeTidePredictions(predictions) {
  const sorted = predictions.map(p => ({
    time: new Date(p.t),
    height: parseFloat(p.v),
    type: p.type
  })).sort((a, b) => a.time - b.time);
  const now = new Date();
  let lastEvent = null, nextEvent = null;
  for (const ev of sorted) {
    if (ev.time <= now) lastEvent = ev;
    else { nextEvent = ev; break; }
  }
  if (!nextEvent && sorted.length) nextEvent = sorted[sorted.length - 1];
  let tideTrend = "steady";
  if (nextEvent && lastEvent) {
    tideTrend = nextEvent.height > lastEvent.height ? "rising" : "falling";
  }
  let nextHigh = null, nextLow = null;
  for (const ev of sorted) {
    if (ev.time > now) {
      if (ev.type === "H" && !nextHigh) nextHigh = ev;
      if (ev.type === "L" && !nextLow) nextLow = ev;
      if (nextHigh && nextLow) break;
    }
  }
  return { lastEvent, nextEvent, tideTrend, nextHigh, nextLow };
}

// -----------------------------
// Modification: Include UV Index in Weather Data
// -----------------------------
async function displayWeatherForLocation(lat, lon) {
  const weatherData = await fetchWeatherData(lat, lon);
  if (!weatherData) {
    console.warn("No weather data found.");
    return;
  }
  currentWeatherData = weatherData;
  const { temp, wind_speed, wind_deg, clouds, uvi } = weatherData.current;
  const name = selectedPlace?.name || "your location";
  const directions = ["North", "North-Northeast", "Northeast", "East-Northeast",
                      "East", "East-Southeast", "Southeast", "South-Southeast",
                      "South", "South-Southwest", "Southwest", "West-Southwest",
                      "West", "West-Northwest", "Northwest", "North-Northwest", "North"];
  const index = (wind_deg !== undefined) ? Math.round((wind_deg % 360) / 22.5) : 0;
  const weatherDiv = document.getElementById("weatherInfo");
  let weatherHTML = `<h2>Current Weather in ${name}</h2><ul>`;
  if (temp !== undefined) weatherHTML += `<li>Air Temperature: ${temp} °F</li>`;
  if (wind_speed !== undefined) {
    weatherHTML += `<li>Wind: ${wind_speed} mph from the ${directions[index]}</li>`;
  }
  if (clouds !== undefined) weatherHTML += `<li>Cloud Coverage: ${clouds}%</li>`;
  if (uvi !== undefined) weatherHTML += `<li>UV Index: ${uvi}</li>`;
  weatherHTML += "</ul>";
  weatherDiv.innerHTML = weatherHTML;
}

async function fetchWeatherData(lat, lon, retries = 3) {
  const weatherUrl = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&units=imperial&exclude=minutely,daily,alerts&appid=${OPENWEATHER_API_KEY}`;
  while (retries > 0) {
    try {
      const response = await fetch(weatherUrl);
      if (!response.ok) { retries--; continue; }
      return await response.json();
    } catch (error) {
      console.error("Error fetching weather data:", error);
      retries--;
    }
  }
  console.error("Failed to fetch weather data after multiple attempts.");
  return null;
}



// -----------------------------
// Tide Details with Chart and UV Data
// -----------------------------
function showFullStationDetail(station, weatherData) {
  const { lastEvent, nextEvent, tideTrend, nextHigh, nextLow } = analyzeTidePredictions(station.predictions);
  const formatTime = d => d.toLocaleString("en-US", { hour: "numeric", minute: "numeric", hour12: true });

  // Prepare tide chart and forecast HTML
  const tideChartHTML = '<canvas id="tideChart"></canvas>';
  const hourlyTableHTML = generateHourlyForecastTable(weatherData);

  // Build header (location name) that spans full width and is centered
  const headerHTML = `<h2 class="modal-location">${station.stationName}</h2>`;

  // If no tide events have occurred, show a simpler layout
  if (!lastEvent) {
    const contentHTML = `
      <div class="modal-content-inner">
        <div class="modal-text">
          <p>No tide events have occurred yet today.</p>
          <h3>Future Tide Events</h3>
          <p><strong>Next High Tide:</strong> ${nextHigh ? formatTime(nextHigh.time) : "None available."}</p>
          <p><strong>Next Low Tide:</strong> ${nextLow ? formatTime(nextLow.time) : "None available."}</p>
        </div>
        <div class="modal-right">
          <div class="modal-chart">
          <p><strong>Tide Forecast (ft)</strong></p> 
            ${tideChartHTML}
          </div>
          <div class="modal-forecast">
            ${hourlyTableHTML}
          </div>
        </div>
      </div>
    `;
    openModal(headerHTML + contentHTML);
    renderTideChart(station.predictions);
    return;
  }
  
  // For normal cases, build left column (text) content
  const currentTideType = lastEvent.type === "H" ? "High Tide" : "Low Tide";
  const currentTideHeight = `${lastEvent.height.toFixed(1)} ft`;
  let trendDescription = `Currently ${tideTrend === "rising" ? "Rising" : "Falling"}`;
  if (nextEvent) {
    const minutesUntilNext = Math.round((nextEvent.time - new Date()) / 60000);
    if (minutesUntilNext > 0) {
      const hours = Math.floor(minutesUntilNext / 60);
      const remainingMinutes = minutesUntilNext % 60;
      let timeString = (hours > 0 ? `${hours} hr ` : "") + (remainingMinutes > 0 ? `${remainingMinutes} min` : "");
      trendDescription += ` – ${nextEvent.type === "H" ? "High" : "Low"} Tide in ${timeString}.`;
    }
  }
  const nextHighText = nextHigh ? formatTime(nextHigh.time) : "Not available.";
  const nextLowText = nextLow ? formatTime(nextLow.time) : "Not available.";
  
  const snorkelingHTML = `
    <h3>Current Conditions</h3>
    <p><strong>Water Clarity:</strong> ${ (weatherData?.current?.clouds ?? 10) < 30 && (weatherData?.current?.wind_speed ?? 5) < 10 ? "Likely good visibility." : "Visibility may be reduced." }</p>
    <p><strong>Wind Impact:</strong> ${weatherData?.current?.wind_speed < 10 ? "Under 10 mph" : weatherData?.current?.wind_speed + " mph"} – ${weatherData?.current?.wind_speed < 10 ? "Minimal impact" : (weatherData?.current?.wind_speed <= 15 ? "Moderate impact" : "Significant impact")}.</p>
    <p><strong>Tide Impact:</strong> ${currentTideType === "Low Tide" && tideTrend === "falling" ? "Low tide may expose shallow areas." : tideTrend === "rising" ? "Rising tide – improving depth." : "Neutral tide impact."}</p>
    <p><strong>Overall Rating:</strong> ${tideTrend === "rising" && (weatherData?.current?.wind_speed ?? 5) < 10 && (weatherData?.current?.clouds ?? 10) < 30 ? "Good" : ((weatherData?.current?.wind_speed ?? 5) > 15 || (weatherData?.current?.clouds ?? 10) > 70 ? "Poor" : "Fair")}</p>
  `;
  
  const weatherHTML = `
    <h3>Weather Overview</h3>
    <p>${Math.round(weatherData?.current?.temp ?? 75)}°F, ${(weatherData?.current?.clouds ?? 10) < 30 ? "Sunny/Clear" : "Cloudy"}, Wind: ${weatherData?.current?.wind_speed?.toFixed(0)} mph ${["North", "North-Northeast", "Northeast", "East-Northeast",
      "East", "East-Southeast", "Southeast", "South-Southeast",
      "South", "South-Southwest", "Southwest", "West-Southwest",
      "West", "West-Northwest", "Northwest", "North-Northwest", "North"][Math.round((weatherData?.current?.wind_deg ?? 0) % 360 / 22.5)]}</p>
    <p><strong>UV Index:</strong> ${weatherData?.current?.uvi ?? "N/A"}</p>
  `;
  
  const leftColumnHTML = `
    ${snorkelingHTML}
    ${weatherHTML}
    <p><strong>Current Tide:</strong> ${currentTideType} at ${currentTideHeight}</p>
    <p><strong>Tide Trend:</strong> ${trendDescription}</p>
    <p><strong>Next High Tide:</strong> ${nextHighText} | <strong>Next Low Tide:</strong> ${nextLowText}</p>
  `;
  
  // Build right column: two equal parts (tide chart and hourly forecast)
  const rightColumnHTML = `
    <div class="modal-right">
      <div class="modal-chart">
        ${tideChartHTML}
      </div>
      <div class="modal-forecast">
        ${hourlyTableHTML}
      </div>
    </div>
  `;
  
  // Combine header, left column, and right column into the final layout
  const html = `
    ${headerHTML}
    <div class="modal-content-inner">
      <div class="modal-text">
        ${leftColumnHTML}
      </div>
      ${rightColumnHTML}
    </div>
  `;
  openModal(html);
  renderTideChart(station.predictions);
}

// -----------------------------
// Responsive Overlay Functions
// -----------------------------
function openModal(content) {
  const modal = document.getElementById("modal");
  const modalContent = document.getElementById("modal-content");
  modalContent.innerHTML = content;
  modal.style.display = "block";
  window.scrollTo({ top: 0, behavior: 'smooth' });
  modal.focus();
}

function closeModal() {
  document.getElementById("modal").style.display = "none";
}

// -----------------------------
// New: Help Function (Instructions)
// -----------------------------
function showHelp() {
  const helpContent = `
    <h2>Website Help</h2>
    <p>Welcome to Snorkel Conditions! Here’s how to use the website:</p>
    <ul>
      <li><strong>Select Location:</strong> Click on the map or type a location in the search box. Data loads automatically.</li>
      <li><strong>Current Weather & Tide:</strong> The main area shows current weather (air temperature, wind, and cloud coverage) and tide information for your selected location.</li>
      <li><strong>Detailed View:</strong> Click on any tide station marker (the numbered items on the map) or scroll down and click the station name to open a detailed overlay with extra info, including an hourly forecast.</li>
      <li><strong>Favorites:</strong> Once signed in, click the star (⭐) next to a tide station to save it as a favorite. Use the "View Favorites" button to see your saved spots.</li>
      <li><strong>Registration & Sign In:</strong> Use the Register and Sign In buttons (in the top bar) to create an account and enable the favorites feature.</li>
    </ul>
    <p>Enjoy exploring the conditions for your snorkeling adventure!</p>
  `;
  openModal(helpContent);
}

// -----------------------------
// Window onLoad Initialization
// -----------------------------
window.onload = () => {
  initializeAutocomplete();
  const defaultCenter = { lat: 39.8283, lng: -98.5795 };
  map = new google.maps.Map(document.getElementById("map"), {
    center: defaultCenter,
    zoom: 4
  });
  map.addListener("click", async (e) => {
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();
    selectedPlace = { name: "Selected Location", lat, lng };
    centerMapAndPlaceUserMarker(lat, lng);
    displayLocationInfo("Selected Location", lat, lng);
    await displayWeatherForLocation(lat, lng);
    fetchTideData(lat, lng);
  });
  // Removed the "Check Conditions" button event listener (data loads automatically)
  document.getElementById("registerLink").addEventListener("click", showRegisterForm);
  document.getElementById("signInLink").addEventListener("click", showSignInForm);
  document.getElementById("signOutLink").addEventListener("click", () => {
    signOutUser();
    updateAuthUI();
  });
  document.getElementById("viewFavoritesLink").addEventListener("click", toggleFavoritesContainer);
  document.getElementById("helpButton").addEventListener("click", showHelp);
  document.getElementById("registerButton").addEventListener("click", () => {
    const username = document.getElementById("registerUsername").value.trim();
    const password = document.getElementById("registerPassword").value;
    if (!username || !password) {
      showNotification("Please enter a username and password.", 'error');
      return;
    }
    if (registerUser(username, password)) {
      document.getElementById("registerUsername").value = "";
      document.getElementById("registerPassword").value = "";
      showSignInForm();
    }
  });
  document.getElementById("signInButton").addEventListener("click", () => {
    const username = document.getElementById("signInUsername").value.trim();
    const password = document.getElementById("signInPassword").value;
    if (!username || !password) {
      showNotification("Please enter username and password.", 'error');
      return;
    }
    if (signInUser(username, password)) {
      document.getElementById("signInUsername").value = "";
      document.getElementById("signInPassword").value = "";
      updateAuthUI();
    }
  });
  document.getElementById("close-modal").addEventListener("click", closeModal);
  document.getElementById("deleteSelectedFavorites").addEventListener("click", deleteSelectedFavorites);
  updateAuthUI();
};
