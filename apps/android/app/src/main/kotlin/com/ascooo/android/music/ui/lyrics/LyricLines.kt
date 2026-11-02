package com.ascooo.android.music.ui.lyrics

import java.io.StringReader
import javax.xml.parsers.DocumentBuilderFactory
import kotlin.math.max
import org.w3c.dom.Document
import org.w3c.dom.Element
import org.w3c.dom.Node
import org.xml.sax.InputSource

// The website's lib/lrc.ts, line for line, so both read lyrics the same way.

data class LyricWord(
  val time: Double,
  val end: Double,
  val text: String,
  /** TTML ttm:role="x-bg": backing vocals, sung around the lead. */
  val background: Boolean = false,
)

data class LyricLine(
  /** Seconds. */
  val time: Double,
  val end: Double? = null,
  val text: String,
  val words: List<LyricWord> = emptyList(),
  /** A synthesized • • • row for an instrumental gap. */
  val interlude: Boolean = false,
)

private val TIME = Regex("""\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?]""")
private val OFFSET = Regex("""^\[offset:\s*([+-]?\d+)\s*]""", setOf(RegexOption.IGNORE_CASE, RegexOption.MULTILINE))
private val INLINE_TIME = Regex("""<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>""")

/** Parse LRC text; supports multiple timestamps per line and the [offset:] tag. */
fun parseLrc(content: String): List<LyricLine> {
  val offset = OFFSET.find(content)?.groupValues?.get(1)?.toDouble()?.div(1000) ?: 0.0
  val out = mutableListOf<LyricLine>()
  for (raw in content.lines()) {
    val stamps = mutableListOf<Double>()
    var last = 0
    for (match in TIME.findAll(raw)) {
      if (match.range.first != last) break // timestamps must be contiguous at line start
      val fraction = match.groupValues[3].takeIf { it.isNotEmpty() }?.padEnd(3, '0')?.toDouble()?.div(1000) ?: 0.0
      stamps += match.groupValues[1].toDouble() * 60 + match.groupValues[2].toDouble() + fraction - offset
      last = match.range.last + 1
    }
    if (stamps.isEmpty()) continue
    // Strip inline word-level timestamps like <00:12.34>
    val text = raw.substring(last).replace(INLINE_TIME, "").trim()
    for (time in stamps) out += LyricLine(time = max(0.0, time), text = text)
  }
  return out.sortedBy { it.time }
}

private val MILLISECONDS = Regex("""^-?\d+(?:\.\d+)?ms$""", RegexOption.IGNORE_CASE)
private val SECONDS = Regex("""^-?\d+(?:\.\d+)?s$""", RegexOption.IGNORE_CASE)
private val NUMBER = Regex("""^-?\d+(?:\.\d+)?$""")

private fun ttmlTime(value: String?): Double? {
  if (value.isNullOrBlank()) return null
  val normalized = value.trim().replace(',', '.')
  if (MILLISECONDS.matches(normalized)) return normalized.dropLast(2).toDouble() / 1000
  if (SECONDS.matches(normalized)) return normalized.dropLast(1).toDouble()
  if (NUMBER.matches(normalized)) return normalized.toDouble()
  val parts = normalized.split(':').map { it.toDoubleOrNull() ?: return null }
  return parts.fold(0.0) { seconds, part -> seconds * 60 + part }
}

private val WHITESPACE = Regex("""[\t\r\n ]+""")

private fun normalizedText(value: String?) = (value ?: "").replace(WHITESPACE, " ").trim()

private const val TTML_METADATA = "http://www.w3.org/ns/ttml#metadata"

/** Apple puts ttm:role="x-bg" on a span wrapping the background words (or on a lone word itself). */
private fun isBackground(span: Element, paragraph: Element): Boolean {
  var node: Node? = span
  while (node is Element && node !== paragraph) {
    if (node.getAttributeNS(TTML_METADATA, "role") == "x-bg") return true
    node = node.parentNode
  }
  return false
}

/**
 * Apple times its TTML against the stereo master. A Dolby Atmos mix can start later, so the file
 * carries `<audio role="spatial" lyricOffset="…"/>`: the seconds to add when the spatial mix plays.
 */
private fun spatialOffset(document: Document): Double {
  val audio = document.getElementsByTagNameNS("*", "audio")
  for (i in 0 until audio.length) {
    val element = audio.item(i) as Element
    if (element.getAttribute("role") == "spatial") return element.getAttribute("lyricOffset").toDoubleOrNull() ?: 0.0
  }
  return 0.0
}

private fun Element.attribute(name: String): String? = if (hasAttribute(name)) getAttribute(name) else null

private fun Element.spans(): List<Element> {
  val list = getElementsByTagNameNS("*", "span")
  return List(list.length) { list.item(it) as Element }
}

/** Parse Apple Music TTML. Pass [spatial] when the Atmos mix, or the AAC 5.1 copy made from it, is playing. */
fun parseTtml(content: String, spatial: Boolean = false): List<LyricLine> {
  val document =
    runCatching {
        DocumentBuilderFactory.newInstance()
          .apply {
            isNamespaceAware = true
            isExpandEntityReferences = false
          }
          .newDocumentBuilder()
          .parse(InputSource(StringReader(content.removePrefix("﻿"))))
      }
      .getOrNull() ?: return emptyList()
  val offset = if (spatial) spatialOffset(document) else 0.0
  fun at(value: String?) = ttmlTime(value)?.plus(offset)

  val paragraphs = document.getElementsByTagNameNS("*", "p")
  val lines = mutableListOf<LyricLine>()
  for (i in 0 until paragraphs.length) {
    val paragraph = paragraphs.item(i) as Element
    // The innermost timed spans: Apple wraps background words in an untimed span of their own.
    val spans = paragraph.spans().filter { span -> span.hasAttribute("begin") && span.spans().none { it.hasAttribute("begin") } }
    val words = mutableListOf<LyricWord>()
    for (span in spans) {
      val time = at(span.attribute("begin")) ?: continue
      val end = at(span.attribute("end")) ?: time
      val text = StringBuilder(span.textContent ?: "")
      var sibling = span.nextSibling
      while (sibling != null && sibling.nodeType == Node.TEXT_NODE) {
        text.append(sibling.textContent ?: "")
        sibling = sibling.nextSibling
      }
      if (text.isNotEmpty()) words += LyricWord(max(0.0, time), max(time, end), text.toString(), isBackground(span, paragraph))
    }

    val text = normalizedText(paragraph.textContent)
    if (text.isEmpty()) continue
    val lineTime = at(paragraph.attribute("begin")) ?: words.firstOrNull()?.time ?: continue
    val lineEnd = at(paragraph.attribute("end")) ?: words.lastOrNull()?.end
    lines += LyricLine(time = max(0.0, lineTime), end = lineEnd?.let { max(lineTime, it) }, text = text, words = words)
  }
  return lines.sortedBy { it.time }
}

private const val OPENING = "(（"
private const val CLOSING = ")）"

/** Whether [text] is one parenthesized group: "(I'm slipping away)", not "(oh) (yeah)". */
private fun isParenthesized(text: String): Boolean {
  val chars = text.trim()
  var depth = 0
  chars.forEachIndexed { index, char ->
    if (char in OPENING) depth += 1 else if (char in CLOSING) depth -= 1
    if (depth <= 0 && index < chars.length - 1) return false
  }
  return chars.length > 1 && depth == 0
}

data class Vocals(val lead: List<LyricWord>, val background: List<LyricWord>)

private val LEADING_PAREN = Regex("""^(\s*)[(（]""")
private val TRAILING_PAREN = Regex("""[)）](\s*)$""")

/**
 * A TTML line's lead words and its background vocals. Apple wraps the background in parentheses
 * inside its first and last words; given a row of its own, it no longer needs them.
 */
fun splitBackground(words: List<LyricWord>): Vocals {
  val lead = words.filter { !it.background }
  val background = words.filter { it.background }
  // A line sung only in the background has no lead to sit under, so it stays as written.
  if (lead.isEmpty()) return Vocals(words, emptyList())
  if (!isParenthesized(background.joinToString("") { it.text })) return Vocals(lead, background)
  val stripped = background.toMutableList()
  stripped[0] = stripped[0].copy(text = stripped[0].text.replace(LEADING_PAREN, "$1"))
  stripped[stripped.lastIndex] = stripped.last().copy(text = stripped.last().text.replace(TRAILING_PAREN, "$1"))
  return Vocals(lead, stripped)
}

private val METADATA_TAG = Regex("""^\[[a-z]+:.*]$""", RegexOption.IGNORE_CASE)

/** Plain (unsynced) lyrics → lines, dropping any stray LRC metadata tags. */
fun plainLines(content: String): List<String> {
  val lines = content.lines().map { it.replace(METADATA_TAG, "").trim() }
  return lines.filterIndexed { index, line -> line.isNotEmpty() || (index > 0 && lines[index - 1].isNotEmpty()) }
}

private const val INTERLUDE_MIN = 5.0 // seconds of silence before a gap earns a • • • row
private const val INTERLUDE_LINGER = 1.0 // let the last sung line stay lit a beat before the dots take over

/**
 * TTML has no instrumental marker: a long silence between one line's end and the next line's
 * start is the interlude (or the intro, before the first line). LRC has no end times, so it's left alone.
 */
fun withInterludes(lines: List<LyricLine>): List<LyricLine> {
  if (lines.none { it.end != null }) return lines
  val out = mutableListOf<LyricLine>()
  var sungUntil = 0.0
  for (line in lines) {
    if (line.time - sungUntil >= INTERLUDE_MIN) {
      out += LyricLine(time = if (out.isEmpty()) 0.0 else sungUntil + INTERLUDE_LINGER, end = line.time, text = "", interlude = true)
    }
    out += line
    // Overlapping lines (duets, background vocals) can end after the next one starts.
    sungUntil = max(sungUntil, line.end ?: line.time)
  }
  return out
}

/** activeIndex switches lines this early. */
const val LINE_LOOKAHEAD = 0.15

/** Binary search: index of the line active at [time], or -1 before the first. */
fun activeIndex(lines: List<LyricLine>, time: Double): Int {
  var lo = 0
  var hi = lines.lastIndex
  var answer = -1
  while (lo <= hi) {
    val mid = (lo + hi) ushr 1
    if (lines[mid].time <= time + LINE_LOOKAHEAD) {
      answer = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return answer
}
