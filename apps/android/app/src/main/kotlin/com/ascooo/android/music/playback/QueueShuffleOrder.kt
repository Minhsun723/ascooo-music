package com.ascooo.android.music.playback

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.source.ShuffleOrder
import java.util.Random

/**
 * A shuffle that keeps the queue's meaning, as the website's does: a new list starts with the track
 * that was picked, tracks put in "play next" come right after the track they were inserted behind,
 * and tracks added to the queue go to its end. Media3's own order scatters inserted tracks at random,
 * which would make both of those meaningless while shuffling.
 */
@OptIn(UnstableApi::class)
class QueueShuffleOrder(private val shuffled: IntArray, private val random: Random = Random()) : ShuffleOrder {
  private val positionOf = IntArray(shuffled.size).also { for ((position, index) in shuffled.withIndex()) it[index] = position }

  override fun getLength(): Int = shuffled.size

  override fun getNextIndex(index: Int): Int = shuffled.getOrNull(positionOf[index] + 1) ?: C.INDEX_UNSET

  override fun getPreviousIndex(index: Int): Int = shuffled.getOrNull(positionOf[index] - 1) ?: C.INDEX_UNSET

  override fun getFirstIndex(): Int = shuffled.firstOrNull() ?: C.INDEX_UNSET

  override fun getLastIndex(): Int = shuffled.lastOrNull() ?: C.INDEX_UNSET

  override fun cloneAndSet(insertionCount: Int, startIndex: Int): ShuffleOrder = startingWith(insertionCount, startIndex, random)

  override fun cloneAndInsert(insertionIndex: Int, insertionCount: Int): ShuffleOrder {
    if (shuffled.isEmpty()) return startingWith(insertionCount, C.INDEX_UNSET, random)
    val order = shuffled.map { if (it >= insertionIndex) it + insertionCount else it }.toMutableList()
    val at =
      when {
        insertionIndex >= shuffled.size -> order.size
        insertionIndex == 0 -> 0
        else -> positionOf[insertionIndex - 1] + 1
      }
    order.addAll(at, List(insertionCount) { insertionIndex + it })
    return QueueShuffleOrder(order.toIntArray(), random)
  }

  override fun cloneAndRemove(indexFrom: Int, indexToExclusive: Int): ShuffleOrder {
    val count = indexToExclusive - indexFrom
    val order = shuffled.filter { it < indexFrom || it >= indexToExclusive }.map { if (it >= indexToExclusive) it - count else it }
    return QueueShuffleOrder(order.toIntArray(), random)
  }

  override fun cloneAndClear(): ShuffleOrder = QueueShuffleOrder(IntArray(0), random)

  companion object {
    /** [count] tracks in random order, led by [first] when it is one of them. */
    fun startingWith(count: Int, first: Int, random: Random = Random()): QueueShuffleOrder {
      val rest = (0 until count).filter { it != first }.shuffled(random)
      val order = if (first in 0 until count) listOf(first) + rest else rest
      return QueueShuffleOrder(order.toIntArray(), random)
    }
  }
}
