"use strict";

// Firebase configuration (unchanged)
const firebaseConfig = {
  apiKey: "AIzaSyDj3lbuSZDwBbpp9UBDL2hxAfrYhZmIEyY",
  authDomain: "snorkel-conditions.firebaseapp.com",
  projectId: "snorkel-conditions",
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Set the CSS variable to the actual viewport height
let vh = window.innerHeight * 0.01;
document.documentElement.style.setProperty('--vh', `${vh}px`);

/*
Global Variables & API Keys
*/
let autocomplete;
let selectedPlace;
let allTideStations = null;
const OPENWEATHER_API_KEY = "b0a3cf6cb3e481420a128390e596ef94";
let currentWeatherData = null;
let map = null;
let tideMarkers = [];
let userMarker = null;
let tideStationsData = null;

/*
Notifications (unchanged)
*/
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
function showError(message) {
  showNotification(message, 'error');
}

/*
Tide Chart Rendering (unchanged)
*/
function renderTideChart(tidePredictions) {
  let chartCanvas = document.getElementById("tideChart");
  if (!chartCanvas) {
    chartCanvas = document.createElement("canvas");
    chartCanvas.id = "tideChart";
    document.getElementById("modal-content").appendChild(chartCanvas);
  }
  const labels = tidePredictions.map(pred => {
    const date = new Date(pred.t);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: 'numeric' });
  });
  const data = tidePredictions.map(pred => parseFloat(pred.v));
  const ctx = chartCanvas.getContext('2d');
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

/*
Helper Functions (unchanged)
*/
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
function closeAuthForms() {
  document.getElementById("formsContainer").style.display = "none";
}
document.querySelectorAll(".close-auth").forEach(btn => {
  btn.addEventListener("click", closeAuthForms);
});

/*
*** Firebase Authentication Changes ***
Removed localStorage‑based auth functions and replaced them with Firebase methods.
*/

// Password validation remains the same.
function isValidPassword(password) {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /[0-9]/.test(password);
}

// Registration using Firebase Auth.
function registerUser(email, password) {
  if (!isValidPassword(password)) {
    showError("Password must be at least 8 characters and contain letters and digits.");
    return;
  }
  auth.createUserWithEmailAndPassword(email, password)
    .then((userCredential) => {
      showNotification("Registration successful! You are now signed in.", 'success');
      updateAuthUI();
      // Clear registration fields after successful signup.
      document.getElementById("registerUsername").value = "";
      document.getElementById("registerPassword").value = "";
    })
    .catch((error) => {
      showError(error.message);
    });
}

// Sign in using Firebase Auth.
function signInUser(email, password) {
  auth.signInWithEmailAndPassword(email, password)
    .then((userCredential) => {
      updateAuthUI();
      document.getElementById("signInUsername").value = "";
      document.getElementById("signInPassword").value = "";
    })
    .catch((error) => {
      showError(error.message);
    });
}

// Sign out using Firebase Auth.
function signOutUser() {
  auth.signOut()
    .then(() => {
      updateAuthUI();
    })
    .catch((error) => {
      showError(error.message);
    });
}

// Add this near your other event listeners in window.onload or after DOM load.
document.getElementById("forgotPasswordButton").addEventListener("click", () => {
  // Retrieve the email from the sign in input field.
  const email = document.getElementById("signInUsername").value.trim();
  
  if (!email) {
    showNotification("Please enter your email to reset your password.", "error");
    return;
  }
  
  // Send the password reset email using Firebase's built-in method.
  auth.sendPasswordResetEmail(email)
    .then(() => {
      showNotification("Password reset email sent. Check your inbox.", "success");
    })
    .catch((error) => {
      showError("Error sending reset email: " + error.message);
    });
});


// New: Use Firebase's currentUser instead of localStorage.
function getCurrentUser() {
  return auth.currentUser;
}

/*
*** Firebase Firestore Favorites Changes ***
Removed localStorage-based favorites management and replaced with Firestore.
*/
function toggleFavoriteStation(stationObj) {
  const user = getCurrentUser();
  if (!user) {
    showNotification("Please sign in to save favorites.", 'error');
    return;
  }
  const favRef = db.collection('users').doc(user.uid).collection('favorites').doc(stationObj.stationId);
  favRef.get().then((doc) => {
    if (doc.exists) {
      // Remove favorite from Firestore.
      favRef.delete().then(() => {
        showNotification(`Removed ${stationObj.stationName} from favorites.`, 'success');
        renderFavorites();
      });
    } else {
      const note = prompt("Add a custom note for this favorite (optional):", "");
      stationObj.note = note;
      stationObj.lastFetched = new Date().toISOString();
      favRef.set(stationObj).then(() => {
        showNotification(`Added ${stationObj.stationName} to favorites.`, 'success');
        renderFavorites();
      });
    }
  }).catch((error) => {
    showError("Error handling favorite: " + error.message);
  });
}

function loadFavorites(callback) {
  const user = getCurrentUser();
  if (!user) {
    callback([]);
    return;
  }
  db.collection('users').doc(user.uid).collection('favorites')
    .get()
    .then((querySnapshot) => {
      const favorites = [];
      querySnapshot.forEach((doc) => {
        favorites.push(doc.data());
      });
      callback(favorites);
    })
    .catch((error) => {
      console.error("Error fetching favorites:", error);
      callback([]);
    });
}

function renderFavorites() {
  const user = getCurrentUser();
  if (!user) return;
  const favoritesList = document.getElementById("favoritesList");
  if (!favoritesList) return;

  loadFavorites((favorites) => {
    favoritesList.innerHTML = "";
    if (favorites.length === 0) {
      favoritesList.innerHTML = "<p>No favorite spots yet.</p>";
      return;
    }
    
    favorites.forEach((fav, idx) => {
      // Create a card container for each favorite
      const card = document.createElement("div");
      card.className = "favorite-card";
      
      // Checkbox for multi-select deletion
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "favorite-checkbox";
      checkbox.dataset.index = idx;
      
      // Create a span with a location pin emoji instead of an image
      const pinSpan = document.createElement("span");
      pinSpan.className = "favorite-pin";
      pinSpan.textContent = "📍";
      
      // Details container
      const detailsDiv = document.createElement("div");
      detailsDiv.className = "favorite-details";
      
      const title = document.createElement("h4");
      title.textContent = fav.stationName;
      
      const note = document.createElement("p");
      note.className = "favorite-note";
      note.textContent = `Note: ${fav.note || "None"}`;
      
      const timestamp = document.createElement("p");
      timestamp.className = "favorite-timestamp";
      timestamp.textContent = `Last Fetched: ${new Date(fav.lastFetched).toLocaleString()}`;
      
      detailsDiv.appendChild(title);
      detailsDiv.appendChild(note);
      detailsDiv.appendChild(timestamp);
      
      // Add a click event on the card to handle showing details
      card.addEventListener("click", () => {
        handleFavoriteClick(fav);
      });
      
      // Assemble the card
      card.appendChild(checkbox);
      card.appendChild(pinSpan);
      card.appendChild(detailsDiv);
      
      favoritesList.appendChild(card);
    });
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
  loadFavorites((favorites) => {
    const batch = db.batch();
    favorites.forEach((fav, index) => {
      if (indicesToDelete.includes(index)) {
        const favDoc = db.collection('users').doc(user.uid).collection('favorites').doc(fav.stationId);
        batch.delete(favDoc);
      }
    });
    batch.commit().then(() => {
      showNotification("Selected favorites removed.", 'success');
      renderFavorites();
    }).catch(error => {
      showError("Error deleting favorites: " + error.message);
    });
  });
}

/*
Update the Authentication UI.
Now uses Firebase's currentUser.
*/
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

/*
Google Maps & Places (unchanged)
*/
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

/*
Location, Weather, and Tides (unchanged)
*/
function displayLocationInfo(name, lat, lng) {
  const resultDiv = document.getElementById("result");
  if (!resultDiv) return;
  resultDiv.style.display = "block";
  resultDiv.innerHTML = `
    <div id="weatherInfo">
      <h3>Loading Weather Information...</h3>
    </div>
    <div id="tideInfo">
      <h3>Loading Tide Information...</h3>
    </div>
  `;
}
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
  tideMarkers.forEach((m) => m.setMap(null));
  tideMarkers = [];
  const bounds = new google.maps.LatLngBounds();
  stations.forEach((station, index) => {
    const position = { lat: station.lat, lng: station.lng };
    const marker = new google.maps.Marker({
      position: position,
      map,
      title: station.name,
      label: (index + 1).toString()
    });
    tideMarkers.push(marker);
    bounds.extend(marker.getPosition());
    marker.addListener("click", () => showTideStationDetail(index));
  });
  map.fitBounds(bounds);
}
function displayTideData(tideData) {
  tideStationsData = tideData;
  const tideDiv = document.getElementById("tideInfo");
  if (!tideDiv) return;
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

/*
Tide Details with Chart and UV Data (unchanged)
*/
function showFullStationDetail(station, weatherData) {
  const { lastEvent, nextEvent, tideTrend, nextHigh, nextLow } = analyzeTidePredictions(station.predictions);
  const formatTime = d => d.toLocaleString("en-US", { hour: "numeric", minute: "numeric", hour12: true });
  const tideChartHTML = '<canvas id="tideChart"></canvas>';
  const hourlyTableHTML = generateHourlyForecastTable(weatherData);
  const headerHTML = `<h2 class="modal-location">${station.stationName}</h2>`;
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
  const rightColumnHTML = `
    <div class="modal-right">
      <div class="modal-chart">
        <p><strong>Tide Forecast (ft)</strong></p> 
        ${tideChartHTML}
      </div>
      <div class="modal-forecast">
        ${hourlyTableHTML}
      </div>
    </div>
  `;
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

/*
Responsive Overlay Functions (unchanged)
*/
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
function showHelp() {
  const helpContent = `
    <h2>Website Help</h2>
    <p>Welcome to Snorkel Conditions! Here’s how to use the website:</p>
    <ul>
      <li><strong>Select Location:</strong> Click on the map or type a location in the search box. Data loads automatically.</li>
      <li><strong>Current Weather & Tide:</strong> The main area shows current weather and tide information for your selected location.</li>
      <li><strong>Detailed View:</strong> Click on any tide station marker or scroll down and click the station name to open a detailed overlay with extra info, including an hourly forecast.</li>
      <li><strong>Favorites:</strong> Once signed in, click the star (⭐) next to a tide station to save it as a favorite. Use the "View Favorites" button to see your saved spots.</li>
      <li><strong>Registration & Sign In:</strong> Use the Register and Sign In buttons (in the top bar) to create an account and enable the favorites feature.</li>
    </ul>
    <p>Enjoy exploring the conditions for your snorkeling adventure!</p>
  `;
  openModal(helpContent);
  document.querySelector(".modal-inner").classList.add("help-modal");
}

/*
Window onLoad Initialization (updated event listeners)
*/
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
  document.getElementById("registerLink").addEventListener("click", showRegisterForm);
  document.getElementById("signInLink").addEventListener("click", showSignInForm);
  document.getElementById("signOutLink").addEventListener("click", signOutUser);
  document.getElementById("viewFavoritesLink").addEventListener("click", toggleFavoritesContainer);
  document.getElementById("helpButton").addEventListener("click", showHelp);
  document.getElementById("registerButton").addEventListener("click", () => {
    const email = document.getElementById("registerUsername").value.trim();
    const password = document.getElementById("registerPassword").value;
    if (!email || !password) {
      showNotification("Please enter an email and password.", 'error');
      return;
    }
    registerUser(email, password);
  });
  document.getElementById("signInButton").addEventListener("click", () => {
    const email = document.getElementById("signInUsername").value.trim();
    const password = document.getElementById("signInPassword").value;
    if (!email || !password) {
      showNotification("Please enter an email and password.", 'error');
      return;
    }
    signInUser(email, password);
  });
  document.getElementById("close-modal").addEventListener("click", closeModal);
  document.getElementById("deleteSelectedFavorites").addEventListener("click", deleteSelectedFavorites);
  updateAuthUI();
};
