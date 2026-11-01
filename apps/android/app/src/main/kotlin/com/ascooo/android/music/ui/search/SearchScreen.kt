package com.ascooo.android.music.ui.search

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.text.input.clearText
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SearchBarDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ascooo.android.music.R
import com.ascooo.android.music.appContainer
import com.ascooo.android.music.data.AscoooApi
import com.ascooo.android.music.data.SearchResults
import com.ascooo.android.music.data.Track
import com.ascooo.android.music.playback.artworkUrl
import com.ascooo.android.music.ui.components.AlbumShelf
import com.ascooo.android.music.ui.components.ArtistShelf
import com.ascooo.android.music.ui.components.EmptyPane
import com.ascooo.android.music.ui.components.ErrorPane
import com.ascooo.android.music.ui.components.Load
import com.ascooo.android.music.ui.components.LoadingPane
import com.ascooo.android.music.ui.components.SectionHeader
import com.ascooo.android.music.ui.components.TrackRow
import com.ascooo.android.music.ui.components.loadOf
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

/** Searches as the query changes, after a short pause in typing like the website. */
class SearchViewModel(private val api: AscoooApi) : ViewModel() {
  val query = TextFieldState()

  /** Null while the query is empty. Older results stay up while the next search loads. */
  var results by mutableStateOf<Load<SearchResults>?>(null)
    private set

  private var attempt by mutableIntStateOf(0)

  init {
    viewModelScope.launch {
      snapshotFlow { query.text.toString().trim() to attempt }
        .distinctUntilChanged()
        .collectLatest { (q, _) ->
          if (q.isEmpty()) {
            results = null
            return@collectLatest
          }
          delay(180)
          if (results !is Load.Ready) results = Load.Loading
          results = loadOf { api.search(q) }
        }
    }
  }

  fun retry() {
    attempt++
  }
}

@Composable
fun SearchScreen(
  onOpenAlbum: (Long) -> Unit,
  onOpenArtist: (Long) -> Unit,
  onPlay: (List<Track>, Int) -> Unit,
  currentId: String?,
  modifier: Modifier = Modifier,
) {
  val container = LocalContext.current.appContainer
  val viewModel = viewModel { SearchViewModel(container.api) }
  val keyboard = LocalSoftwareKeyboardController.current

  // Results and the empty state stop at the keyboard instead of running under it.
  Column(modifier.fillMaxSize().statusBarsPadding().imePadding()) {
    Text("搜尋", style = MaterialTheme.typography.headlineMediumEmphasized, modifier = Modifier.padding(start = 20.dp, top = 24.dp, bottom = 12.dp))
    SearchField(viewModel.query, onSearch = { keyboard?.hide() }, Modifier.padding(horizontal = 16.dp))
    when (val results = viewModel.results) {
      null -> EmptyPane(R.drawable.ic_search, "搜尋音樂", copy = "找一段熟悉的聲音")
      Load.Loading -> LoadingPane()
      is Load.Failed -> ErrorPane(results.message, viewModel::retry)
      is Load.Ready ->
        Results(
          results.data,
          container.baseUrl,
          onOpenAlbum = {
            keyboard?.hide()
            onOpenAlbum(it)
          },
          onOpenArtist = {
            keyboard?.hide()
            onOpenArtist(it)
          },
          onPlay = { tracks, index ->
            keyboard?.hide()
            onPlay(tracks, index)
          },
          onScroll = { keyboard?.hide() },
          currentId = currentId,
        )
    }
  }
}

/**
 * A text field dressed as M3's search bar. Not the SearchBar component itself: its input only
 * expands into a separate full-screen search view and takes no typing while collapsed, but this tab
 * is already the search page.
 */
@Composable
private fun SearchField(state: TextFieldState, onSearch: () -> Unit, modifier: Modifier = Modifier) {
  val container = MaterialTheme.colorScheme.surfaceContainerHigh
  TextField(
    state = state,
    modifier = modifier.fillMaxWidth().heightIn(min = SearchBarDefaults.InputFieldHeight),
    placeholder = { Text("歌曲、專輯或藝人") },
    leadingIcon = { Icon(painterResource(R.drawable.ic_search), contentDescription = null) },
    trailingIcon = {
      if (state.text.isNotEmpty()) {
        IconButton(onClick = { state.clearText() }, shapes = IconButtonDefaults.shapes()) {
          Icon(painterResource(R.drawable.ic_close), contentDescription = "清除")
        }
      }
    },
    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
    onKeyboardAction = { onSearch() },
    lineLimits = TextFieldLineLimits.SingleLine,
    shape = SearchBarDefaults.inputFieldShape,
    colors =
      TextFieldDefaults.colors(
        focusedContainerColor = container,
        unfocusedContainerColor = container,
        focusedIndicatorColor = Color.Transparent,
        unfocusedIndicatorColor = Color.Transparent,
      ),
  )
}

// Same sections in the same order as the website: artists, albums, then songs.
@Composable
private fun Results(
  results: SearchResults,
  baseUrl: String,
  onOpenAlbum: (Long) -> Unit,
  onOpenArtist: (Long) -> Unit,
  onPlay: (List<Track>, Int) -> Unit,
  onScroll: () -> Unit,
  currentId: String?,
) {
  if (results.artists.isEmpty() && results.albums.isEmpty() && results.tracks.isEmpty()) {
    EmptyPane(R.drawable.ic_search, "沒有相符的音樂", copy = "試試藝人全名、專輯名稱，或縮短搜尋字詞。")
    return
  }
  val listState = rememberLazyListState()
  LaunchedEffect(listState) {
    snapshotFlow { listState.isScrollInProgress }.collectLatest { if (it) onScroll() }
  }
  LazyColumn(Modifier.fillMaxSize(), listState, contentPadding = PaddingValues(bottom = 24.dp)) {
    if (results.artists.isNotEmpty()) {
      item(key = "artists-title") { SectionHeader("藝人") }
      item(key = "artists") { ArtistShelf(results.artists, baseUrl, onOpenArtist) }
    }
    if (results.albums.isNotEmpty()) {
      item(key = "albums-title") { SectionHeader("專輯") }
      item(key = "albums") { AlbumShelf(results.albums, baseUrl, onOpenAlbum) }
    }
    if (results.tracks.isNotEmpty()) {
      item(key = "tracks-title") { SectionHeader("歌曲") }
      itemsIndexed(results.tracks, key = { _, track -> track.id }) { index, track ->
        TrackRow(
          track,
          artworkUrl(baseUrl, track.artworkId),
          onClick = { onPlay(results.tracks, index) },
          current = track.id.toString() == currentId,
        )
      }
    }
  }
}
