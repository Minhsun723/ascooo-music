# Retrofit, OkHttp, kotlinx.serialization, Media3, Coil and DataStore ship their own R8 rules.
# Add a rule here only for something R8 turns out to break.

# Retrofit reads a suspend function's result type from its generic signature. A response class the
# app never reads (OkResponse, LikeResponse) would otherwise be removed, leaving the signature as Any,
# and the call would fail with "Serializer for class 'Any' is not found". Keep every API model.
-keep,allowobfuscation,allowoptimization @kotlinx.serialization.Serializable class com.ascooo.android.music.data.**

# Crash reports keep their file names and line numbers.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
